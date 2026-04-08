# AGENTS.md

## Setup Commands

### Frontend
- Install dependencies: `npm install`
- Start development server: `npm run dev`
- Run tests: `npm test`
- Build for production: `npm run build`

### Backend
- Install dependencies: `cd backend && poetry install --with dev`
- Start development server: `cd backend && poetry run uvicorn app.main:app --reload`
- Run tests: `cd backend && poetry run pytest`
- Run tests with coverage gate: `cd backend && poetry run pytest --cov-fail-under=80`

## Code Style

### Frontend
- Use TypeScript strict mode
- Prefer functional components in React
- Use ESLint and Prettier configurations
- Follow conventional commit format

### Backend
- Follow PEP 8 and existing code conventions
- Use type annotations for function signatures
- Follow conventional commit format

## Testing Guidelines

### Frontend
- Write unit tests for all new functions
- Use Jest for testing framework
- Aim for >80% code coverage
- Run tests before committing

### Backend
- Write unit tests for all new functions
- Use pytest for testing framework
- Use `pytest-asyncio` (auto mode) for async tests — no `@pytest.mark.asyncio` decorator needed
- Aim for >80% code coverage
- Run tests before committing

## Project Structure
- `/frontend/src` - Frontend application code
- `/frontend/tests` - Frontend test files
- `/backend/app` - Backend application code
- `/backend/tests` - Backend test files
- `/docs` - Documentation
- `/public` - Static assets

## Development Workflow
- Create feature branches from `main`
- Use pull requests for code review
- Squash commits before merging
- Update documentation for new features
