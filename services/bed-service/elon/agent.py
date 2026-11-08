"""
Core Agent Engine for ELON (Clinical & Facility Operations Coordinator)
"""
import datetime
import json
import logging
import os
import re
from typing import Optional, Dict, Any
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from elon.schemas import UserContext, ElonChatResponse
from elon.guardrails import screen_input_prompt, screen_output_phi
from elon import tools

logger = logging.getLogger("hip.bed.elon.agent")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ELON_MODEL_NAME = os.getenv("BED_RECOMMENDER_MODEL", "gemini-1.5-flash")

SYSTEM_PROMPT = """You are ELON, the Clinical & Facility Operations Coordinator for the Hospital Intelligence Platform (HIP).
Your persona is concise, operational, helpful, strictly professional, and objective.
You assist hospital personnel (doctors, nurses, housekeeping/EVS staff, and administrators) with real-time operational coordination: bed availability, cleaning queues, capacity metrics, and bed placement holds.

IMPORTANT OPERATIONAL CONSISTENCY & ACCURACY RULES:
- Always base all bed counts, department metrics, and statuses strictly on the provided 'Verified Operational Data'.
- Do NOT confuse an individual department's bed capacity with the hospital-wide total (which has 120 beds across 5 units: Emergency 30, General Ward 30, ICU 25, Step-Down 25, Surgery 10).
- If the user asks about a specific department (e.g., ICU, Emergency, General Ward, Step-Down, Surgery), report THAT specific department's exact total, available, and occupied counts from the provided data.
- When reporting available beds, state the exact total count (e.g., 118 available hospital-wide, or 28 available in Emergency) and summarize the unit breakdown accurately.
- Provide simple, direct question-and-answer responses.
- Do NOT include technical debug statistics, cache hit numbers, SQL statements, or large multi-column tables.
- Keep responses brief (1 to 3 short paragraphs or clean bullet points).
- For DOCTOR / NURSE / ADMIN staff: Provide full operational context including admission holds, acuity, primary diagnosis, and staged equipment.
- For CLEANING_CREW / EVS staff: You ONLY provide bed codes, room numbers, dirty/clean status, and cleaning priorities. You NEVER disclose patient names, medical record numbers, diagnoses, clinical notes, or medical history. If asked for patient details, inform them that EVS staff are restricted to bed turnaround data.
"""


def _extract_bed_code(text: str) -> Optional[str]:
    match = re.search(r"\b(ER|ICU|PACU|MED|SURG|GW|SD)[-\s]?(\d{3})\b", text, re.IGNORECASE)
    if match:
        return f"{match.group(1).upper()}-{match.group(2)}"
    return None


def _detect_department(text: str) -> Optional[str]:
    lower = text.lower()
    if any(k in lower for k in ["icu", "intensive care", "critical care"]):
        return "ICU"
    if re.search(r"\b(er|emergency|trauma|ed)\b", lower):
        return "EMERGENCY"
    if any(k in lower for k in ["general ward", "general", "gw", "ward", "med surg", "medical surgical"]):
        return "GENERAL_WARD"
    if any(k in lower for k in ["step down", "stepdown", "step-down", "intermediate", "sd", "telemetry"]):
        return "STEP_DOWN"
    if any(k in lower for k in ["surgery", "surgical", "operating room", " or "]):
        return "SURGERY"
    return None


async def ask_elon(
    message: str,
    user_context: UserContext,
    db: AsyncSession,
    redis: Optional[aioredis.Redis] = None,
    session_id: Optional[str] = None
) -> ElonChatResponse:
    """
    Main entry point for conversational operational interactions with ELON.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clean_session_id = session_id or f"elon-session-{user_context.user_id}"

    # 1. Input Guardrail: Screen for prompt injections & adversarial inputs
    is_safe, reason = screen_input_prompt(message)
    if not is_safe:
        return ElonChatResponse(
            response="I am unable to process this request. As the Hospital Intelligence Platform operations coordinator, I only process hospital operational, bed management, and facility coordination queries.",
            session_id=clean_session_id,
            timestamp=now_iso,
        )

    # 2. Redis Cache Lookup (transparent, no debug headers in user message)
    cache_key = f"elon:cache:{user_context.role}:{message.strip().lower()}"
    if redis:
        try:
            cached_val = await redis.get(cache_key)
            if cached_val:
                return ElonChatResponse(
                    response=cached_val,
                    session_id=clean_session_id,
                    timestamp=now_iso,
                )
        except Exception as e:
            logger.debug("Redis cache check error: %s", e)

    # 3. Deterministic Operational Tool Execution
    bed_code_match = _extract_bed_code(message)
    department = _detect_department(message)
    tool_data: Dict[str, Any] = {}
    query_type = "general"

    lower_msg = message.lower()

    if bed_code_match and any(w in lower_msg for w in ["hold", "why", "who", "reserved", "status", "patient", "detail"]):
        query_type = "bed_hold"
        tool_data = await tools.get_bed_clinical_hold_details(db, bed_code_match, user_context)
    elif any(w in lower_msg for w in ["dirty", "clean", "turnover", "evs", "housekeeping"]):
        query_type = "cleaning"
        tool_data["cleaning_queue"] = await tools.get_cleaning_tasks_queue(db, department=department)
    elif any(w in lower_msg for w in ["capacity", "census", "occupancy", "how many beds", "how many bed", "bed count", "total beds", "total capacity"]):
        query_type = "capacity"
        tool_data["capacity"] = await tools.get_hospital_capacity_metrics(db, department=department)
    elif any(w in lower_msg for w in ["available", "free", "vacant", "open"]):
        query_type = "available_beds"
        tool_data["beds"] = await tools.get_bed_status_overview(db, department=department, status="AVAILABLE", limit=50)
    else:
        query_type = "general_overview"
        tool_data["beds"] = await tools.get_bed_status_overview(db, department=department, limit=20)
        tool_data["capacity"] = await tools.get_hospital_capacity_metrics(db, department=department)

    # Hard RBAC short-circuit for unauthorized EVS attempts
    if tool_data.get("error") == "ACCESS_DENIED":
        final_answer = tool_data["message"]
        return ElonChatResponse(
            response=final_answer,
            session_id=clean_session_id,
            timestamp=now_iso,
        )

    # 4. Synthesize Natural Language Answer
    final_answer = ""
    if GEMINI_API_KEY:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            from langchain_core.messages import SystemMessage, HumanMessage

            llm = ChatGoogleGenerativeAI(
                model=ELON_MODEL_NAME,
                google_api_key=GEMINI_API_KEY,
                temperature=0.2,
                timeout=15.0,
            )
            prompt = (
                f"User Role: {user_context.role} ({user_context.full_name or user_context.username}, {user_context.department or 'General'})\n"
                f"User Query: {message}\n"
                f"Verified Operational Data: {json.dumps(tool_data, default=str)}\n\n"
                f"Please provide a simple, professional, concise response answering the user directly based on the data."
            )
            llm_res = await llm.ainvoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt)])
            if isinstance(llm_res.content, str):
                final_answer = llm_res.content.strip()
            elif isinstance(llm_res.content, list):
                text_parts = []
                for part in llm_res.content:
                    if isinstance(part, str):
                        text_parts.append(part)
                    elif isinstance(part, dict) and "text" in part:
                        text_parts.append(part["text"])
                final_answer = " ".join(text_parts).strip()
            else:
                final_answer = str(llm_res.content).strip()
        except Exception as e:
            logger.warning("Gemini model execution failed or timed out: %s; falling back to deterministic answer.", e)
            final_answer = _build_deterministic_answer(query_type, tool_data, message, user_context)
    else:
        final_answer = _build_deterministic_answer(query_type, tool_data, message, user_context)

    # 5. Output Guardrail: Scrub any unintended PHI for CLEANING_CREW
    final_answer = screen_output_phi(final_answer, user_context.role)

    # 6. Save in Redis Cache (TTL: 180s)
    if redis and final_answer:
        try:
            await redis.set(cache_key, final_answer, ex=180)
        except Exception as e:
            logger.debug("Redis cache set error: %s", e)

    return ElonChatResponse(
        response=final_answer,
        session_id=clean_session_id,
        timestamp=now_iso,
    )


def _build_deterministic_answer(
    query_type: str,
    tool_data: Dict[str, Any],
    message: str,
    user_context: UserContext
) -> str:
    """Generates clean, professional responses matching Image 1 simplicity."""
    if query_type == "bed_hold":
        if tool_data.get("error") == "NOT_FOUND":
            return tool_data["message"]
        code = tool_data.get("bed_code", "Bed")
        status = tool_data.get("status", "AVAILABLE")
        if status in ["RESERVED", "OCCUPIED"]:
            diag = tool_data.get("primary_diagnosis", "Under Clinical Evaluation")
            acuity = tool_data.get("acuity_level", "ESI_2")
            staged = tool_data.get("staged_equipment", [])
            staged_str = f" Pre-staged equipment: {', '.join(staged)}." if staged else ""
            return f"{code} is currently {status} for an {acuity} patient diagnosed with {diag}.{staged_str}"
        return f"{code} is currently {status} with no active clinical allocation hold."

    if query_type == "cleaning":
        queue = tool_data.get("cleaning_queue", [])
        if not queue:
            return "Good news: There are currently no beds flagged as DIRTY or pending turnover."
        items = [f"{b['bed_code']} ({b['department']}, Room {b['room_number']}) - {b['cleaning_status']}" for b in queue[:5]]
        count = len(queue)
        suffix = f" (showing top 5 of {count})" if count > 5 else ""
        return f"There {'is' if count == 1 else 'are'} currently {count} bed{'s' if count != 1 else ''} needing turnover{suffix}:\n• " + "\n• ".join(items)

    if query_type == "capacity":
        cap = tool_data.get("capacity", {})
        scope = cap.get("scope", "Hospital-wide")
        total = cap.get("total_beds", 120)
        avail = cap.get("available_beds", 0)
        occ = cap.get("occupied_beds", 0)
        res = cap.get("reserved_holds", 0)
        dirty = cap.get("dirty_beds", 0)
        pct = cap.get("occupancy_rate_pct", 0.0)
        dept_breakdown = cap.get("department_breakdown", {})

        dept_summary = ""
        if not cap.get("department") and dept_breakdown:
            dept_lines = [f"  - {d}: {data['total']} total ({data['AVAILABLE']} available, {data['OCCUPIED']} occupied)" for d, data in dept_breakdown.items()]
            dept_summary = "\nDepartment breakdown:\n" + "\n".join(dept_lines)

        return (
            f"Capacity overview ({scope}):\n"
            f"• Available Beds: {avail} of {total}\n"
            f"• Active Occupancy: {occ} occupied, {res} reserved ({pct}% occupancy rate)\n"
            f"• Beds Pending Cleaning: {dirty}{dept_summary}"
        )

    if query_type == "available_beds":
        beds_data = tool_data.get("beds", {})
        if isinstance(beds_data, list):
            count = len(beds_data)
            codes = [b["bed_code"] for b in beds_data[:8]]
            return f"There are {count} available beds. The nearest available beds include: {', '.join(codes)}."

        total = beds_data.get("total_matching", 0)
        dept_counts = beds_data.get("department_counts", {})
        samples = [b["bed_code"] for b in beds_data.get("beds_sample", [])[:8]]
        if total == 0:
            return "There are currently no beds flagged as AVAILABLE matching your criteria."
        if dept_counts:
            dept_lines = [f"{d}: {c}" for d, c in dept_counts.items()]
            return f"There are {total} available beds across the hospital ({', '.join(dept_lines)}). Sample available beds: {', '.join(samples)}."
        return f"There are {total} available beds. Sample available beds: {', '.join(samples)}."

    # General overview
    cap = tool_data.get("capacity", {})
    avail = cap.get("available_beds", 0)
    total = cap.get("total_beds", 120)
    return f"Hospital systems are synchronized. Currently {avail} of {total} physical beds are available across departments. How can I assist you with bed allocation or turnover?"
