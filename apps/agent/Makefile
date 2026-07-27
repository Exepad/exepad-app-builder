# =============================================================================
# Exepad Agent Development Makefile
# =============================================================================
# Usage: make <target>
# Run 'make help' to see all available targets

.PHONY: help install format format-check lint typecheck static test test-unit test-integration test-cov test-validation-confidence test-replay-smoke test-replay-all check precommit clean

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Help
# =============================================================================

help:  ## Show this help message
	@echo "Exepad Agent Development Commands"
	@echo "================================="
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# =============================================================================
# Installation
# =============================================================================

install:  ## Install all dependencies (production + dev)
	pip install -r requirements.txt
	pip install -r requirements-dev.txt
	@echo "✅ All dependencies installed"

install-dev:  ## Install only dev dependencies
	pip install -r requirements-dev.txt
	@echo "✅ Dev dependencies installed"

# =============================================================================
# Code Formatting (Black)
# =============================================================================

format:  ## Auto-format code with Black
	black main_agent/ agent_api.py config.py tests/
	@echo "✅ Code formatted with Black"

format-check:  ## Check formatting without making changes
	black --check --diff main_agent/ agent_api.py config.py tests/
	@echo "✅ Formatting check passed"

# =============================================================================
# Linting (Flake8)
# =============================================================================

lint:  ## Run flake8 linting
	flake8 main_agent/ agent_api.py config.py
	@echo "✅ Flake8 linting passed"

lint-all:  ## Run flake8 on all Python files including tests
	flake8 main_agent/ agent_api.py config.py tests/
	@echo "✅ Flake8 linting passed (all files)"

# =============================================================================
# Type Checking (Mypy)
# =============================================================================

typecheck:  ## Run mypy type checking
	mypy main_agent/ agent_api.py config.py --ignore-missing-imports
	@echo "✅ Mypy type checking passed"

# =============================================================================
# Static Analysis (Combined)
# =============================================================================

static:  ## Run all static analysis (format-check + lint + typecheck)
	@echo "Running format check..."
	@make format-check
	@echo ""
	@echo "Running linting..."
	@make lint
	@echo ""
	@echo "Running type checking..."
	@make typecheck
	@echo ""
	@echo "✅ All static analysis passed"

# =============================================================================
# Testing
# =============================================================================

test:  ## Run all tests (excludes eval tests)
	pytest tests/ -v --ignore=tests/eval
	@echo "✅ All tests passed"

test-unit:  ## Run only unit tests (fast)
	pytest tests/unit -v
	@echo "✅ Unit tests passed"

test-integration:  ## Run only integration tests
	pytest tests/integration -v -m "integration"
	@echo "✅ Integration tests passed"

test-cov:  ## Run tests with coverage report
	pytest tests/ --cov=main_agent --cov-report=term-missing --cov-report=html --ignore=tests/eval
	@echo "✅ Tests passed with coverage"
	@echo "📊 HTML coverage report: htmlcov/index.html"

test-fast:  ## Run tests in parallel (requires pytest-xdist)
	pytest tests/ -v -n auto --ignore=tests/eval
	@echo "✅ Tests passed (parallel)"

test-validation-confidence:  ## Deterministic PR gate for validation-critical code
	python -m coverage erase
	python -m coverage run --rcfile=.coveragerc.validation -m pytest \
		tests/unit/test_syntax_validator.py \
		tests/unit/test_contrast_example_fixtures.py \
		tests/unit/test_style_coverage_contracts.py \
		tests/unit/test_validation_contract_cases.py \
		tests/unit/test_codefocus_semantic.py \
		tests/unit/test_semantic_validator_contracts.py \
		tests/unit/test_semantic_validator_m3_pairing.py \
		tests/unit/test_style_contrast_validation.py \
		tests/unit/test_design_system_validator.py \
		tests/unit/test_failure_classification.py \
		tests/unit/test_handler_semantic_validator.py \
		tests/unit/test_cross_validator_chart_data.py \
		tests/unit/test_cross_validator_auth.py \
		tests/unit/test_validation_service.py \
		tests/unit/test_codefocus_artifact_tools.py \
		tests/unit/test_eval_registry_consistency.py \
		tests/unit/test_replay_sanitizer.py \
		tests/replay/test_validation_replays.py \
		-v \
		-m "unit or replay"
	python -m coverage report -m
	python -m coverage xml -o validation-coverage.xml
	python -m coverage json -o validation-coverage.json
	python tests/confidence/check_validation_coverage.py validation-coverage.json --line-threshold 85 --branch-threshold 70
	@echo "✅ Validation confidence gate passed"

test-replay-smoke:  ## Run smoke subset of deterministic replay cases
	pytest tests/replay/test_validation_replays.py -v -m "confidence_pr"
	@echo "✅ Replay smoke cases passed"

test-replay-all:  ## Run the full deterministic replay corpus
	pytest tests/replay/test_validation_replays.py -v -m "replay"
	@echo "✅ Replay corpus passed"

# =============================================================================
# ADK Agent Evaluation
# =============================================================================

eval:  ## Run all ADK agent evaluations (ROUGE-1 only, fast)
	pytest tests/eval -v -m "eval_fast"
	@echo "✅ All agent evaluations passed"

eval-fast:  ## Run fast ROUGE-1 evaluations (CI/CD friendly)
	pytest tests/eval -v -m "eval_fast"
	@echo "✅ Fast evaluations passed"

eval-rubric:  ## Run LLM-as-judge rubric evaluations (slower, higher confidence)
	pytest tests/eval -v -m "eval_rubric"
	@echo "✅ Rubric evaluations passed"

eval-all:  ## Run both ROUGE-1 and rubric evaluations
	pytest tests/eval -v -m "eval_fast or eval_rubric"
	@echo "✅ All evaluations passed"

eval-routing:  ## Run routing layer evaluations (AppHelpDeskAgent)
	pytest tests/eval -v -m "eval_routing"
	@echo "✅ Routing layer evaluations passed"

eval-planning:  ## Declarative planning evals removed with webapp; nothing to run
	@echo "Skipping: no eval_planning tests (AppCreator/AppEditor/AppBlogger eval wrappers removed)."

eval-building:  ## Run deterministic building confidence replays and pipeline cases
	pytest tests/replay/test_validation_replays.py -v -m "eval_building"
	@echo "✅ Building layer evaluations passed"

eval-support:  ## Run support layer evaluations (ResultResponseWriter)
	pytest tests/eval -v -m "eval_support"
	@echo "✅ Support layer evaluations passed"

eval-cli:  ## Run evaluations using ADK CLI (alternative method)
	adk eval main_agent tests/eval/
	@echo "✅ ADK CLI evaluations passed"

# =============================================================================
# Combined Checks
# =============================================================================

check:  ## Quick dev check (format-check + lint + unit tests)
	@echo "🔍 Running quick check..."
	@echo ""
	@make format-check
	@echo ""
	@make lint
	@echo ""
	@make test-unit
	@echo ""
	@echo "✅ Quick check passed!"

precommit:  ## Full check before commit (all static + all tests)
	@echo "🔍 Running pre-commit checks..."
	@echo ""
	@echo "=== Format Check ==="
	@make format-check
	@echo ""
	@echo "=== Linting ==="
	@make lint
	@echo ""
	@echo "=== Type Checking ==="
	@make typecheck
	@echo ""
	@echo "=== All Tests ==="
	@make test
	@echo ""
	@echo "✅ All pre-commit checks passed! Ready to commit."

# =============================================================================
# Cleanup
# =============================================================================

clean:  ## Clean up generated files and caches
	rm -rf __pycache__
	rm -rf .pytest_cache
	rm -rf .mypy_cache
	rm -rf htmlcov
	rm -rf .coverage
	rm -rf *.egg-info
	rm -rf dist
	rm -rf build
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type f -name "*.pyo" -delete 2>/dev/null || true
	find . -type f -name ".coverage" -delete 2>/dev/null || true
	@echo "✅ Cleaned up generated files"

# =============================================================================
# Development Server
# =============================================================================

run:  ## Run the development server
	uvicorn agent_api:app --host 0.0.0.0 --port 8080 --reload

run-prod:  ## Run production server (no reload)
	uvicorn agent_api:app --host 0.0.0.0 --port 8080
