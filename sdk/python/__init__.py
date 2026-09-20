"""
ModusFlow Omega — Reliability Substrate for Python AI Agents.
"""

from .omega_protect import omega_protect, FailureClass, evaluate_invariant, classify_error

__version__ = "0.1.0"
__all__ = ["omega_protect", "FailureClass", "evaluate_invariant", "classify_error"]
