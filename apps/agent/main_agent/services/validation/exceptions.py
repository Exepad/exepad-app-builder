"""Custom exceptions for the Code Focus validation pipeline."""


class SyntaxValidationError(Exception):
    """Raised when syntax validation fails after all retries."""

    def __init__(self, file_type: str, errors: list[str]):
        self.file_type = file_type
        self.errors = errors
        super().__init__(
            f"{file_type} syntax validation failed after retries: {'; '.join(errors[:3])}"
        )


class SemanticValidationError(Exception):
    """Raised when semantic validation fails after all retries."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(f"Semantic validation failed after retries: {'; '.join(errors[:3])}")


class CssCompilationError(Exception):
    """Raised when Tailwind CSS compilation fails."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(f"CSS compilation failed: {'; '.join(errors[:3])}")
