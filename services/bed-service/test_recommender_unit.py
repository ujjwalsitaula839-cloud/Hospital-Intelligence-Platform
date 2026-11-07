"""Hermetic Unit Tests for LangChain Bed & Equipment Recommendation Engine.

100% offline, zero-network egress, mocks LLM inference.
Safe for GitHub Actions backend-ci runner.
"""

import os
import sys
from pathlib import Path
from typing import Any, Dict, List
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Add services/bed-service to PYTHONPATH
bed_service_dir = Path(__file__).resolve().parent
if str(bed_service_dir) not in sys.path:
    sys.path.insert(0, str(bed_service_dir))

from pydantic import ValidationError

from recommender import (
    AlternativeBed,
    BedRecommendationRequest,
    BedRecommendationResponse,
    EquipmentPrestageItem,
    PatientTriageInfo,
    deterministic_fallback_recommender,
    format_candidates_compact,
    format_equipment_compact,
    format_patient_for_prompt,
    generate_bed_recommendation,
    get_or_build_recommendation_chain,
)


class MockLLMWithStructuredOutput:
    """Mock LLM returning predefined structured responses without external API calls."""

    def __init__(self, canned_response: BedRecommendationResponse):
        self.canned_response = canned_response

    def with_structured_output(self, schema: Any):
        mock_runnable = MagicMock()
        mock_runnable.ainvoke = AsyncMock(return_value=self.canned_response)
        return mock_runnable

    def __or__(self, other):
        mock_pipe = MagicMock()
        mock_pipe.ainvoke = AsyncMock(return_value=self.canned_response)
        return mock_pipe


class TestBedRecommendationSchemas(unittest.TestCase):
    """Suite 1: Data Contract & Validation Edge Cases."""

    def test_valid_patient_triage_info(self):
        patient = PatientTriageInfo(
            full_name="Alice Walker",
            age=45,
            gender="F",
            acuity_level="ESI_2",
            chief_complaint="Severe shortness of breath",
            primary_diagnosis="Severe Asthma Exacerbation",
            systolic_bp=140,
            diastolic_bp=90,
            heart_rate=118,
            respiratory_rate=28,
            oxygen_saturation=91.5,
            temperature_celsius=37.1,
            requires_isolation=False,
            requires_bariatric=False,
        )
        self.assertEqual(patient.acuity_level, "ESI_2")
        self.assertEqual(patient.oxygen_saturation, 91.5)

    def test_response_confidence_score_boundaries(self):
        # Valid confidence score
        resp = BedRecommendationResponse(
            recommended_bed_code="ICU-201",
            department="ICU",
            bed_type="STANDARD",
            confidence_score=0.95,
            clinical_rationale="Patient requires critical hemodynamic monitoring.",
            is_immediate_ready=True,
        )
        self.assertEqual(resp.confidence_score, 0.95)

        # Confidence > 1.0 must fail
        with self.assertRaises(ValidationError):
            BedRecommendationResponse(
                recommended_bed_code="ICU-201",
                department="ICU",
                bed_type="STANDARD",
                confidence_score=1.5,
                clinical_rationale="Invalid score",
            )

        # Confidence < 0.0 must fail
        with self.assertRaises(ValidationError):
            BedRecommendationResponse(
                recommended_bed_code="ICU-201",
                department="ICU",
                bed_type="STANDARD",
                confidence_score=-0.2,
                clinical_rationale="Invalid score",
            )

    def test_prompt_formatting_helper(self):
        patient = PatientTriageInfo(
            full_name="Bob Test",
            acuity_level="ESI_1",
            requires_isolation=True,
            infection_type="Airborne COVID-19",
        )
        formatted = format_patient_for_prompt(patient)
        self.assertEqual(formatted["patient_name"], "Bob Test")
        self.assertEqual(formatted["requires_isolation"], "YES")
        self.assertEqual(formatted["infection_type"], "Airborne COVID-19")
        self.assertEqual(formatted["systolic_bp"], "N/A")

    def test_format_candidates_compact(self):
        candidates = [
            {"bed_code": "ER-101", "department": "EMERGENCY", "bed_type": "STANDARD", "status": "AVAILABLE", "room_number": "Bay-1"},
            {"bed_code": "ICU-201", "department": "ICU", "bed_type": "ISOLATION", "status": "AVAILABLE", "room_number": "ICU-1"},
        ]
        compact = format_candidates_compact(candidates)
        self.assertIn("Bed ER-101 | Dept: EMERGENCY | Type: STANDARD | Status: AVAILABLE | Room: Bay-1", compact)
        self.assertIn("Bed ICU-201 | Dept: ICU | Type: ISOLATION | Status: AVAILABLE | Room: ICU-1", compact)
        self.assertEqual(format_candidates_compact([]), "None available")

    def test_format_equipment_compact(self):
        equipment = [
            {"equipment_name": "Mechanical Ventilator #01", "equipment_type": "Ventilator", "status": "AVAILABLE"},
            {"equipment_name": "Telemetry Monitor #04", "equipment_type": "Cardiac Monitor", "status": "AVAILABLE"},
        ]
        compact = format_equipment_compact(equipment)
        self.assertIn("- Mechanical Ventilator #01 (Type: Ventilator, Status: AVAILABLE)", compact)
        self.assertIn("- Telemetry Monitor #04 (Type: Cardiac Monitor, Status: AVAILABLE)", compact)
        self.assertEqual(format_equipment_compact([]), "None available")

    def test_singleton_chain_caching(self):
        with patch("langchain_google_genai.ChatGoogleGenerativeAI") as mock_chat_cls, \
             patch("langchain_core.prompts.ChatPromptTemplate.from_messages") as mock_prompt_cls:
            mock_llm = MagicMock()
            mock_chat_cls.return_value = mock_llm
            mock_pipe = MagicMock()
            mock_prompt_cls.return_value.__or__.return_value = mock_pipe

            chain1 = get_or_build_recommendation_chain("test_key", "mock-model", 0.1)
            chain2 = get_or_build_recommendation_chain("test_key", "mock-model", 0.1)

            # Assert chain instance is cached and not reinstantiated
            self.assertIs(chain1, chain2)
            self.assertEqual(mock_chat_cls.call_count, 1)


class TestDeterministicFallbackEngine(unittest.TestCase):
    """Suite 2: Rule-Based Deterministic Fallback (Zero-LLM Mode)."""

    def setUp(self):
        self.candidates = [
            {"bed_id": 1, "bed_code": "ER-101", "department": "EMERGENCY", "bed_type": "STANDARD", "status": "AVAILABLE", "version": 1},
            {"bed_id": 2, "bed_code": "ER-102", "department": "EMERGENCY", "bed_type": "ISOLATION", "status": "AVAILABLE", "version": 1},
            {"bed_id": 3, "bed_code": "ER-103", "department": "EMERGENCY", "bed_type": "STANDARD", "status": "DIRTY", "version": 2},
            {"bed_id": 4, "bed_code": "ICU-201", "department": "ICU", "bed_type": "STANDARD", "status": "AVAILABLE", "version": 1},
        ]
        self.equipment = [
            {"equipment_id": 1, "equipment_name": "Mechanical Ventilator", "status": "AVAILABLE"},
            {"equipment_id": 2, "equipment_name": "Cardiac Telemetry Monitor", "status": "AVAILABLE"},
        ]

    def test_fallback_selects_isolation_bed_when_requested(self):
        patient = PatientTriageInfo(
            full_name="Infectious Patient",
            acuity_level="ESI_2",
            requires_isolation=True,
            oxygen_saturation=95.0,
        )
        res = deterministic_fallback_recommender(patient, self.candidates, self.equipment)
        self.assertEqual(res.recommended_bed_code, "ER-102")
        self.assertEqual(res.bed_type, "ISOLATION")
        self.assertEqual(res.mode, "DETERMINISTIC_RULES_FALLBACK")
        self.assertTrue(res.is_immediate_ready)
        self.assertTrue(any("Isolation" in p for p in res.infection_control_precautions))

    def test_fallback_respiratory_compromise_stages_ventilator(self):
        patient = PatientTriageInfo(
            full_name="Hypoxic Patient",
            acuity_level="ESI_1",
            oxygen_saturation=86.0,
            heart_rate=130,
        )
        res = deterministic_fallback_recommender(patient, self.candidates, self.equipment)
        equipment_types = [e.equipment_type for e in res.equipment_to_prestage]
        self.assertIn("Mechanical Ventilator", equipment_types)
        self.assertIn("Cardiac Telemetry Monitor", equipment_types)

    def test_fallback_esi2_non_intubated_does_not_stage_ventilator(self):
        # Rule 3: For ESI_2 non-intubated respiratory patients, do NOT pre-stage a ventilator
        patient = PatientTriageInfo(
            full_name="Asthma Patient",
            acuity_level="ESI_2",
            oxygen_saturation=91.0,
            heart_rate=115,
            notes="Wheezing, responding to nebulizers, not intubated"
        )
        res = deterministic_fallback_recommender(patient, self.candidates, self.equipment)
        equipment_types = [e.equipment_type for e in res.equipment_to_prestage]
        self.assertNotIn("Mechanical Ventilator", equipment_types)
        self.assertIn("Cardiac Telemetry Monitor", equipment_types)

    def test_fallback_never_stages_crash_cart(self):
        # Rule 2: Never place Crash Cart inside patient room
        patient = PatientTriageInfo(
            full_name="Critical Patient",
            acuity_level="ESI_1",
            heart_rate=140
        )
        res = deterministic_fallback_recommender(patient, self.candidates, self.equipment)
        equipment_types = [e.equipment_type.lower() for e in res.equipment_to_prestage]
        self.assertFalse(any("crash cart" in t for t in equipment_types))

    def test_fallback_max_one_unit_per_type(self):
        # Rule 1: Never assign more than ONE (1) unit of any primary equipment type
        patient = PatientTriageInfo(
            full_name="Complex Patient",
            acuity_level="ESI_1",
            heart_rate=135,
            oxygen_saturation=85.0
        )
        res = deterministic_fallback_recommender(patient, self.candidates, self.equipment)
        equipment_types = [e.equipment_type for e in res.equipment_to_prestage]
        self.assertEqual(len(equipment_types), len(set(equipment_types)))

    def test_fallback_empty_candidate_pool_raises_value_error(self):
        patient = PatientTriageInfo(acuity_level="ESI_3")
        with self.assertRaises(ValueError):
            deterministic_fallback_recommender(patient, [], self.equipment)


class TestLCELPipelineAndGuardrails(unittest.IsolatedAsyncioTestCase):
    """Suite 3: Single-Pass LCEL Execution & Anti-Hallucination Guardrails."""

    def setUp(self):
        self.candidates = [
            {"bed_id": 10, "bed_code": "ICU-205", "department": "ICU", "bed_type": "STANDARD", "status": "AVAILABLE", "version": 1},
            {"bed_id": 11, "bed_code": "ICU-206", "department": "ICU", "bed_type": "STANDARD", "status": "DIRTY", "version": 3},
        ]
        self.equipment = [
            {"equipment_id": 5, "equipment_name": "Alaris Infusion Pump", "status": "AVAILABLE"}
        ]
        self.patient = PatientTriageInfo(
            full_name="STEMI Patient",
            acuity_level="ESI_1",
            primary_diagnosis="Acute Myocardial Infarction",
            heart_rate=125,
            systolic_bp=88,
        )

    async def test_successful_mocked_llm_recommendation(self):
        canned_res = BedRecommendationResponse(
            recommended_bed_code="ICU-205",
            department="ICU",
            bed_type="STANDARD",
            confidence_score=0.98,
            clinical_rationale="Patient requires immediate invasive monitoring in ICU.",
            equipment_to_prestage=[
                EquipmentPrestageItem(
                    equipment_type="Cardiac Monitor",
                    priority="MANDATORY",
                    reason="Arrhythmia surveillance"
                )
            ],
            is_immediate_ready=True,
            mode="AI_RECOMMENDATION",
        )

        mock_llm = MagicMock()
        mock_chain = MagicMock()
        mock_chain.ainvoke = AsyncMock(return_value=canned_res)
        mock_llm.with_structured_output.return_value = mock_chain

        with patch("langchain_core.prompts.ChatPromptTemplate.from_messages", return_value=MagicMock(__or__=lambda s, o: mock_chain)):
            res = await generate_bed_recommendation(
                self.patient,
                self.candidates,
                self.equipment,
                llm_override=mock_llm
            )

        self.assertEqual(res.recommended_bed_code, "ICU-205")
        self.assertEqual(res.department, "ICU")
        self.assertEqual(res.confidence_score, 0.98)
        self.assertEqual(res.mode, "AI_RECOMMENDATION")
        self.assertTrue(res.is_immediate_ready)

    async def test_anti_hallucination_guardrail_catches_invalid_bed_code(self):
        # LLM returns a hallucinated bed code NOT in candidates
        hallucinated_res = BedRecommendationResponse(
            recommended_bed_code="BED-GHOST-999",
            department="FANTASY_WARD",
            bed_type="STANDARD",
            confidence_score=0.99,
            clinical_rationale="Hallucinated bed",
            is_immediate_ready=True,
        )

        mock_llm = MagicMock()
        mock_chain = MagicMock()
        mock_chain.ainvoke = AsyncMock(return_value=hallucinated_res)
        mock_llm.with_structured_output.return_value = mock_chain

        with patch("langchain_core.prompts.ChatPromptTemplate.from_messages", return_value=MagicMock(__or__=lambda s, o: mock_chain)):
            res = await generate_bed_recommendation(
                self.patient,
                self.candidates,
                self.equipment,
                llm_override=mock_llm
            )

        # Must fall back to deterministic selector and choose a REAL candidate
        self.assertEqual(res.mode, "DETERMINISTIC_RULES_FALLBACK")
        self.assertIn(res.recommended_bed_code, {"ICU-205", "ICU-206"})
        self.assertNotEqual(res.recommended_bed_code, "BED-GHOST-999")

    async def test_llm_exception_triggers_graceful_fallback(self):
        # Simulate LLM timeout or network error
        mock_llm = MagicMock()
        mock_chain = MagicMock()
        mock_chain.ainvoke = AsyncMock(side_effect=TimeoutError("LLM Gateway Timed Out"))
        mock_llm.with_structured_output.return_value = mock_chain

        with patch("langchain_core.prompts.ChatPromptTemplate.from_messages", return_value=MagicMock(__or__=lambda s, o: mock_chain)):
            res = await generate_bed_recommendation(
                self.patient,
                self.candidates,
                self.equipment,
                llm_override=mock_llm
            )

        self.assertEqual(res.mode, "DETERMINISTIC_RULES_FALLBACK")
        self.assertEqual(res.recommended_bed_code, "ICU-205")


class TestGatedLiveGeminiIntegration(unittest.IsolatedAsyncioTestCase):
    """Suite 4: Live Google Gemini Integration (Gated behind environment flag)."""

    async def test_live_gemini_call(self):
        run_live = os.getenv("RUN_LIVE_LLM_TESTS", "false").lower() in ("true", "1")
        gemini_key = os.getenv("GEMINI_API_KEY", "")

        if not run_live or not gemini_key:
            self.skipTest("Live Gemini integration test skipped (RUN_LIVE_LLM_TESTS not enabled or GEMINI_API_KEY unset).")

        candidates = [
            {"bed_id": 1, "bed_code": "ER-101", "department": "EMERGENCY", "bed_type": "STANDARD", "status": "AVAILABLE", "version": 1},
            {"bed_id": 2, "bed_code": "ICU-201", "department": "ICU", "bed_type": "STANDARD", "status": "AVAILABLE", "version": 1},
        ]
        equipment = [
            {"equipment_id": 1, "equipment_name": "Mechanical Ventilator", "status": "AVAILABLE"}
        ]
        patient = PatientTriageInfo(
            full_name="Live Test Patient",
            acuity_level="ESI_1",
            primary_diagnosis="Severe Sepsis",
            systolic_bp=75,
            heart_rate=135,
        )

        res = await generate_bed_recommendation(patient, candidates, equipment)
        self.assertIn(res.recommended_bed_code, ["ER-101", "ICU-201"])
        self.assertEqual(res.mode, "AI_RECOMMENDATION")


def run_tests():
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestBedRecommendationSchemas))
    suite.addTests(loader.loadTestsFromTestCase(TestDeterministicFallbackEngine))
    suite.addTests(loader.loadTestsFromTestCase(TestLCELPipelineAndGuardrails))
    suite.addTests(loader.loadTestsFromTestCase(TestGatedLiveGeminiIntegration))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    run_tests()

