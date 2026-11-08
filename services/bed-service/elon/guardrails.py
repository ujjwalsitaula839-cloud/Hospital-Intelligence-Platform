"""
Security and HIPAA Guardrails for ELON
"""
import re
from typing import Tuple

# Adversarial prompt injection keywords
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"system\s+prompt\s+override", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+in\s+developer\s+mode", re.IGNORECASE),
    re.compile(r"reveal\s+your\s+(system\s+)?instructions", re.IGNORECASE),
    re.compile(r"act\s+as\s+DAN\b", re.IGNORECASE),
]

# Sensitive PHI patterns (MRNs, SSNs, medical diagnoses)
PHI_KEYWORDS = [
    re.compile(r"\bMRN[-\s:]*\d{4,10}\b", re.IGNORECASE),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),  # SSN
    re.compile(r"\b(tuberculosis|HIV|malignancy|carcinoma|bipolar|schizophrenia|overdose|suicide)\b", re.IGNORECASE),
]


def screen_input_prompt(prompt: str) -> Tuple[bool, str]:
    """
    Screens incoming user prompt for injection or adversarial attempts.
    Returns (is_safe: bool, reason: str).
    """
    for pattern in INJECTION_PATTERNS:
        if pattern.search(prompt):
            return False, "Adversarial or unauthorized system command detected."
    return True, ""


def screen_output_phi(text: str, role: str) -> str:
    """
    Ensures that non-clinical roles (CLEANING_CREW / EVS) never receive raw PHI.
    If PHI is detected for a cleaner, redacts or returns standardized notice.
    """
    if role.upper() != "CLEANING_CREW":
        return text

    for pattern in PHI_KEYWORDS:
        if pattern.search(text):
            return (
                "Notice: Clinical health records and patient diagnoses are restricted to authorized "
                "clinical staff. Environmental Services personnel can access room numbers and bed turnaround status."
            )
    return text

