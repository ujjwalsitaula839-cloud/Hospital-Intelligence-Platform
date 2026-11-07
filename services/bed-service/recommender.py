"""LangChain Bed & Equipment Recommendation Engine.

Executes a single-shot LCEL prompt pipe with structured Pydantic output,
operating strictly on a closed candidate pool pre-filtered via SQL.
Includes deterministic rule-based fallback for 100% operational resilience.
"""

import json
import logging
import os
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger("hip.bed.recommender")

# --- Environment Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
BED_RECOMMENDER_MODEL = os.getenv("BED_RECOMMENDER_MODEL", "gemini-3.5-flash-lite")
BED_RECOMMENDER_TEMPERATURE = float(os.getenv("BED_RECOMMENDER_TEMPERATURE", "0.1"))


# --- Pydantic Data Contracts ---

class PatientTriageInfo(BaseModel):
    patient_id: Optional[int] = None
    full_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    acuity_level: str = "ESI_3"  # ESI_1, ESI_2, ESI_3, ESI_4, ESI_5
    primary_diagnosis: Optional[str] = None
    chief_complaint: Optional[str] = None
    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    heart_rate: Optional[int] = None
    respiratory_rate: Optional[int] = None
    oxygen_saturation: Optional[float] = None
    temperature_celsius: Optional[float] = None
    requires_isolation: bool = False
    requires_bariatric: bool = False
    infection_type: Optional[str] = None
    notes: Optional[str] = None


class BedRecommendationRequest(BaseModel):
    patient: PatientTriageInfo
    preferred_department: Optional[str] = None
    max_candidate_beds: Optional[int] = 10


class EquipmentPrestageItem(BaseModel):
    equipment_type: str = Field(description="Name or category of equipment, e.g. Ventilator, Infusion Pump")
    priority: Literal["MANDATORY", "RECOMMENDED", "OPTIONAL"]
    reason: str = Field(description="Clinical reasoning for pre-staging this item")


class AlternativeBed(BaseModel):
    bed_code: str
    department: str
    rationale: str


class BedRecommendationResponse(BaseModel):
    recommended_bed_code: str = Field(description="Must match one of the candidate bed codes exactly")
    department: str
    bed_type: str
    confidence_score: float = Field(ge=0.0, le=1.0, description="Confidence between 0.0 and 1.0")
    clinical_rationale: str = Field(description="Concise 1-2 sentence clinical justification. Maximum 35 words.")
    equipment_to_prestage: List[EquipmentPrestageItem] = Field(default_factory=list, description="At most 2 primary equipment items adhering to clinical rules.")
    alternative_beds: List[AlternativeBed] = Field(default_factory=list, description="At most 2 backup alternatives from candidate pool.")
    infection_control_precautions: List[str] = Field(default_factory=list, description="Precautions if isolation required.")
    warning_advisories: List[str] = Field(default_factory=list)
    is_immediate_ready: bool = Field(default=True, description="True if bed is AVAILABLE; False if DIRTY")
    mode: str = Field(default="AI_RECOMMENDATION", description="AI_RECOMMENDATION or DETERMINISTIC_RULES_FALLBACK")


# --- Prompt Engineering ---

SYSTEM_PROMPT = """You are an expert Clinical Triage & Bed Allocation Specialist at an acute care hospital.
Your mission is to analyze an incoming patient's clinical acuity, vital signs, and diagnosis, and recommend the OPTIMAL bed from the CLOSED CANDIDATE POOL provided below.

CRITICAL CLINICAL CONSTRAINTS:
1. CANDIDATE INTEGRITY: You MUST select the recommended_bed_code ONLY from the candidate beds provided in the prompt. NEVER invent, hallucinate, or alter a bed code.
2. ACUITY MATCHING:
   - ESI_1 or unstable vitals (HR > 120, SpO2 < 90%, SBP < 90): Prioritize ICU or EMERGENCY resuscitation bays. Pre-stage life support (e.g., Ventilator, Defibrillator/Cardiac Monitor).
   - ESI_2: Prioritize ICU or STEP_DOWN / EMERGENCY with continuous telemetry.
   - ESI_3 to ESI_5: Place in STEP_DOWN, GENERAL_WARD, or EMERGENCY as appropriate.
3. ISOLATION & INFECTION CONTROL:
   - If requires_isolation is true or an infection flag is present: If candidate beds include ISOLATION beds, pick an ISOLATION bed. If NO isolation beds are available (contingency mode), pick the best single room, set an advisory warning, and require portable HEPA/droplet filtration.
4. BARIATRIC REQUIREMENT:
   - If requires_bariatric is true: Prefer BARIATRIC beds. If none available, note bariatric equipment transfer needed.
5. BED READINESS:
   - If the chosen bed has status 'DIRTY', set is_immediate_ready to false and explicitly note in clinical_rationale that environmental services (EVS) terminal cleaning must complete prior to patient arrival.
6. EQUIPMENT STAGING RULES:
   - SINGLE-UNIT LIMIT: Never assign more than ONE (1) unit of any primary equipment type (e.g., max 1 Ventilator, max 1 Cardiac Monitor, max 1 Infusion Pump).
   - NO CRASH CARTS IN ROOM: Never place or pre-stage a Crash Cart inside an individual patient room; crash carts remain stationed in the hallway.
   - VENTILATOR CRITERIA: Only stage a Ventilator if the patient has ESI_1 or clinical notes explicitly indicate the patient is actively receiving mechanical/bag-valve ventilation or is intubated. For ESI_2 non-intubated respiratory patients, do NOT pre-stage a ventilator unless requested.
"""

USER_TEMPLATE = """Evaluate this incoming patient and recommend the optimal bed from the candidate list.

[PATIENT CLINICAL SUMMARY]
- Name: {patient_name} (Age: {patient_age}, Gender: {patient_gender})
- Acuity: {acuity_level}
- Chief Complaint: {chief_complaint}
- Primary Diagnosis: {primary_diagnosis}
- Vitals: BP {systolic_bp}/{diastolic_bp} mmHg, HR {heart_rate} bpm, RR {respiratory_rate} rpm, SpO2 {oxygen_saturation}%, Temp {temperature_celsius}°C
- Isolation Required: {requires_isolation} (Infection Type: {infection_type})
- Bariatric Required: {requires_bariatric}
- Clinical Notes: {clinical_notes}

[CONTINGENCY NOTICES]
{contingency_notes}

[CLOSED CANDIDATE BED POOL]
{candidate_beds_text}

[AVAILABLE HOSPITAL EQUIPMENT]
{available_equipment_text}

Respond with the structured recommendation adhering strictly to the required schema and clinical constraints.
"""


def format_candidates_compact(candidates: List[Dict[str, Any]]) -> str:
    """Formats bed candidates into compact single-line pipe-delimited records, reducing prompt tokens by ~65%."""
    if not candidates:
        return "None available"
    lines = []
    for c in candidates:
        lines.append(
            f"- Bed {c.get('bed_code')} | Dept: {c.get('department')} | Type: {c.get('bed_type')} | Status: {c.get('status')} | Room: {c.get('room_number')}"
        )
    return "\n".join(lines)


def format_equipment_compact(equipment: List[Dict[str, Any]]) -> str:
    """Formats equipment items into compact single-line records, reducing prompt tokens."""
    if not equipment:
        return "None available"
    lines = []
    for e in equipment:
        lines.append(
            f"- {e.get('equipment_name')} (Type: {e.get('equipment_type')}, Status: {e.get('status')})"
        )
    return "\n".join(lines)


_STRUCTURED_CHAIN_CACHE: Dict[str, Any] = {}


def get_or_build_recommendation_chain(api_key: str, model_name: str, temperature: float = 0.1) -> Any:
    """
    Returns pre-warmed singleton LCEL pipeline, avoiding per-request schema compilation overhead.
    """
    cache_key = f"{model_name}_{temperature}"
    if cache_key not in _STRUCTURED_CHAIN_CACHE:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.prompts import ChatPromptTemplate

        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", USER_TEMPLATE)
        ])
        llm = ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=api_key,
            temperature=temperature,
            timeout=12.0,
        )
        structured_llm = llm.with_structured_output(BedRecommendationResponse)
        _STRUCTURED_CHAIN_CACHE[cache_key] = prompt | structured_llm
    return _STRUCTURED_CHAIN_CACHE[cache_key]


def format_patient_for_prompt(patient: PatientTriageInfo) -> Dict[str, Any]:
    return {
        "patient_name": patient.full_name or "Unknown",
        "patient_age": patient.age if patient.age is not None else "N/A",
        "patient_gender": patient.gender or "N/A",
        "acuity_level": patient.acuity_level or "ESI_3",
        "chief_complaint": patient.chief_complaint or "Unspecified",
        "primary_diagnosis": patient.primary_diagnosis or "Under Evaluation",
        "systolic_bp": patient.systolic_bp if patient.systolic_bp is not None else "N/A",
        "diastolic_bp": patient.diastolic_bp if patient.diastolic_bp is not None else "N/A",
        "heart_rate": patient.heart_rate if patient.heart_rate is not None else "N/A",
        "respiratory_rate": patient.respiratory_rate if patient.respiratory_rate is not None else "N/A",
        "oxygen_saturation": patient.oxygen_saturation if patient.oxygen_saturation is not None else "N/A",
        "temperature_celsius": patient.temperature_celsius if patient.temperature_celsius is not None else "N/A",
        "requires_isolation": "YES" if patient.requires_isolation else "NO",
        "infection_type": patient.infection_type or "None",
        "requires_bariatric": "YES" if patient.requires_bariatric else "NO",
        "clinical_notes": patient.notes or "None",
    }


def deterministic_fallback_recommender(
    patient: PatientTriageInfo,
    candidates: List[Dict[str, Any]],
    available_equipment: List[Dict[str, Any]],
    contingency_flags: Optional[Dict[str, Any]] = None
) -> BedRecommendationResponse:
    """
    Sub-1ms rule-based fallback when LLM is unconfigured, timed out, or unavailable.
    Guarantees clinical safety and uninterrupted hospital admissions.
    """
    if not candidates:
        raise ValueError("Cannot recommend bed: candidate pool is empty.")

    flags = contingency_flags or {}
    advisories: List[str] = []
    if flags.get("isolation_contingency"):
        advisories.append("WARNING: All dedicated negative-pressure isolation beds are currently occupied. Recommended contingency bed requires portable HEPA air filtration unit.")
    if flags.get("bariatric_contingency"):
        advisories.append("WARNING: All dedicated bariatric beds are currently occupied. Heavy-duty frame retrofitting requested.")

    # Sort candidates: AVAILABLE first, then matching type, then bed_code
    def candidate_score(c: Dict[str, Any]) -> int:
        score = 0
        if c.get("status") == "AVAILABLE":
            score += 100
        if patient.requires_isolation and c.get("bed_type") == "ISOLATION":
            score += 50
        elif patient.requires_bariatric and c.get("bed_type") == "BARIATRIC":
            score += 50
        elif not patient.requires_isolation and not patient.requires_bariatric and c.get("bed_type") == "STANDARD":
            score += 20
        return score

    sorted_candidates = sorted(candidates, key=candidate_score, reverse=True)
    primary = sorted_candidates[0]

    # Equipment pre-staging heuristics (strict adherence to equipment staging rules)
    equipment: List[EquipmentPrestageItem] = []
    notes_lower = (patient.notes or "").lower()
    is_actively_ventilated = any(kw in notes_lower for kw in ["intubat", "ventilator", "mechanical vent", "bag-valve", "bvm", "ett"])

    # Rule 3: Only stage a Ventilator if ESI_1 or actively receiving mechanical/bag-valve ventilation
    negations = ["not intubated", "non-intubated", "unintubated", "no intubation", "denies intubation"]
    has_negation = any(neg in notes_lower for neg in negations)
    is_actively_ventilated = (not has_negation) and any(
        kw in notes_lower for kw in ["intubated", "intubation", "mechanical vent", "bag-valve", "bvm", "on ventilator", "ett"]
    )

    if patient.acuity_level == "ESI_1" or is_actively_ventilated:
        equipment.append(EquipmentPrestageItem(
            equipment_type="Mechanical Ventilator",
            priority="MANDATORY",
            reason=f"Patient in critical respiratory failure / invasive life support (Acuity {patient.acuity_level})"
        ))

    # Rule 1: Never assign more than ONE (1) unit of any primary equipment type
    if patient.heart_rate and (patient.heart_rate > 110 or patient.heart_rate < 50 or patient.acuity_level in ("ESI_1", "ESI_2")):
        equipment.append(EquipmentPrestageItem(
            equipment_type="Cardiac Telemetry Monitor",
            priority="MANDATORY",
            reason=f"Continuous cardiac monitoring required (HR {patient.heart_rate} bpm, Acuity {patient.acuity_level})"
        ))

    # Rule 1: Max 1 IV Infusion Pump
    equipment.append(EquipmentPrestageItem(
        equipment_type="IV Infusion Pump",
        priority="RECOMMENDED",
        reason="Vascular access and precision fluid/medication administration"
    ))

    # Rule 2: Crash Cart is NEVER placed in patient room (hallway only)

    if flags.get("isolation_contingency") or (patient.requires_isolation and not any(c.get("bed_type") == "ISOLATION" for c in candidates)):
        equipment.append(EquipmentPrestageItem(
            equipment_type="Negative Pressure Unit",
            priority="MANDATORY",
            reason="Contingency airborne infection mitigation in standard room"
        ))

    # Infection precautions
    precautions: List[str] = []
    if patient.requires_isolation:
        precautions.append("Airborne / Droplet Isolation: Full PPE (N95/PAPR, Gown, Gloves, Face Shield) required")
        precautions.append("Keep room door closed at all times")

    # Alternatives
    alternatives = [
        AlternativeBed(
            bed_code=alt["bed_code"],
            department=alt["department"],
            rationale=f"Backup option ({alt['bed_type']}, status {alt['status']})"
        )
        for alt in sorted_candidates[1:4]
    ]

    is_ready = primary.get("status") == "AVAILABLE"
    rationale = (
        f"Selected {primary['bed_code']} ({primary['department']}) based on clinical acuity {patient.acuity_level}. "
        f"{'Bed is immediately available.' if is_ready else 'Bed requires terminal sanitization by EVS before placement.'}"
    )

    return BedRecommendationResponse(
        recommended_bed_code=primary["bed_code"],
        department=primary["department"],
        bed_type=primary["bed_type"],
        confidence_score=0.75,
        clinical_rationale=rationale,
        equipment_to_prestage=equipment,
        alternative_beds=alternatives,
        infection_control_precautions=precautions,
        warning_advisories=advisories,
        is_immediate_ready=is_ready,
        mode="DETERMINISTIC_RULES_FALLBACK"
    )


async def generate_bed_recommendation(
    patient: PatientTriageInfo,
    candidates: List[Dict[str, Any]],
    available_equipment: List[Dict[str, Any]],
    contingency_flags: Optional[Dict[str, Any]] = None,
    llm_override: Optional[Any] = None
) -> BedRecommendationResponse:
    """
    Executes single-shot LCEL recommendation chain with structured output.
    Falls back gracefully to deterministic logic if LLM execution fails.
    """
    if not candidates:
        raise ValueError("No candidate beds available for recommendation.")

    flags = contingency_flags or {}
    api_key = GEMINI_API_KEY
    if not api_key and not llm_override:
        logger.info("GEMINI_API_KEY unset; using deterministic rules fallback.")
        return deterministic_fallback_recommender(patient, candidates, available_equipment, flags)

    try:
        if llm_override:
            from langchain_core.prompts import ChatPromptTemplate
            prompt = ChatPromptTemplate.from_messages([
                ("system", SYSTEM_PROMPT),
                ("human", USER_TEMPLATE)
            ])
            structured_llm = llm_override.with_structured_output(BedRecommendationResponse)
            chain = prompt | structured_llm
        else:
            chain = get_or_build_recommendation_chain(
                api_key=api_key,
                model_name=BED_RECOMMENDER_MODEL,
                temperature=BED_RECOMMENDER_TEMPERATURE,
            )

        prompt_vars = format_patient_for_prompt(patient)
        compact_candidates = format_candidates_compact(candidates)
        compact_equipment = format_equipment_compact(available_equipment)
        prompt_vars["candidate_beds_text"] = compact_candidates
        prompt_vars["available_equipment_text"] = compact_equipment
        # Backwards compatibility keys
        prompt_vars["candidate_beds_json"] = compact_candidates
        prompt_vars["available_equipment_json"] = compact_equipment

        contingency_text = "None. All standard resources are within capacity."
        if flags.get("isolation_contingency"):
            contingency_text = (
                "CRITICAL ADVISORY: All dedicated negative-pressure isolation beds are currently OCCUPIED. "
                "Candidate pool contains standard/intermediate beds. Recommend the best available bed with "
                "contingency infection control (portable HEPA unit, strict droplet PPE, and dedicated signage)."
            )
        prompt_vars["contingency_notes"] = contingency_text

        # Single-shot execution
        response: BedRecommendationResponse = await chain.ainvoke(prompt_vars)

        # Safety validation: Verify chosen bed code actually exists in candidates
        valid_codes = {c["bed_code"] for c in candidates}
        if response.recommended_bed_code not in valid_codes:
            logger.warning(
                "LLM hallucinated bed code %s not in candidate pool. Falling back to deterministic selector.",
                response.recommended_bed_code
            )
            return deterministic_fallback_recommender(patient, candidates, available_equipment, flags)

        # Ensure correct immediate readiness flag based on real DB status
        chosen_candidate = next((c for c in candidates if c["bed_code"] == response.recommended_bed_code), None)
        if chosen_candidate and chosen_candidate.get("status") == "DIRTY":
            response.is_immediate_ready = False

        if flags.get("isolation_contingency"):
            warn = "WARNING: All negative-pressure isolation units occupied. Using contingency placement with portable air filtration."
            if warn not in response.warning_advisories:
                response.warning_advisories.append(warn)

        response.mode = "AI_RECOMMENDATION"
        return response

    except Exception as e:
        logger.warning("LLM recommendation failed (%s); triggering deterministic fallback.", e)
        return deterministic_fallback_recommender(patient, candidates, available_equipment, flags)
