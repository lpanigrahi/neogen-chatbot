# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `pnpm dev` - Start development server with hot-reloading
- `pnpm dev:https` - Start development server with HTTPS
- `pnpm build:local` - Build for local production (sets NO_HTTPS='1')
- `pnpm start` - Start production server
- `pnpm check` - Run lint, type check, and unit tests

### Testing
- `pnpm test` - Run unit tests (Vitest)
- `pnpm test:watch` - Run unit tests in watch mode
- `pnpm test:e2e` - Run end-to-end tests (Playwright)
- `pnpm test:e2e:ui` - Run E2E tests with UI
- `pnpm playwright:install` - Install Playwright browsers (run once)

### Code Quality
- `pnpm lint` - Run Next.js ESLint and Biome linting
- `pnpm lint:fix` - Fix linting issues automatically
- `pnpm format` - Format code with Biome
- `pnpm check-types` - TypeScript type checking

### Database
- `pnpm docker:pg` - Start PostgreSQL in Docker
- `pnpm db:generate` - Generate Drizzle migrations
- `pnpm db:push` - Push schema changes to database
- `pnpm db:studio` - Open Drizzle Studio
- `pnpm db:migrate` - Run database migrations

### Docker
- `pnpm docker-compose:up` - Start all services with Docker Compose
- `pnpm docker-compose:down` - Stop Docker Compose services

## Architecture Overview

### Core Structure
- **Next.js App Router**: Uses `src/app/` directory structure with route groups
- **Database**: PostgreSQL with Drizzle ORM, schema in `src/lib/db/pg/schema.pg.ts`
- **Authentication**: Better Auth library with support for OAuth providers
- **AI Integration**: Vercel AI SDK with multiple LLM providers (OpenAI, Anthropic, Google, etc.)
- **MCP Protocol**: Model Context Protocol for tool integration

### Key Directories
- `src/app/` - Next.js app router pages and API routes
- `src/components/` - React components organized by feature
- `src/lib/` - Core business logic and utilities
- `src/lib/ai/` - AI-related functionality (models, tools, MCP, workflows)
- `src/lib/db/` - Database schema and migrations
- `src/lib/auth/` - Authentication configuration

### MCP (Model Context Protocol)
- Enables AI tools and server integrations
- Configuration stored in database or file-based
- MCP clients managed through `src/lib/ai/mcp/`
- Tool customization and OAuth support included

### AI Features
- Multi-provider LLM support with unified interface
- Built-in tools: web search, code execution, data visualization
- Custom agents with tool access
- Visual workflows for automation
- Voice chat with OpenAI Realtime API

### Testing Setup
- Unit tests with Vitest (excludes `/tests` directory)
- E2E tests with Playwright in `/tests` directory
- Authentication states and setup projects configured
- Mobile and desktop test configurations

## Environment Setup

Required environment variables:
- `POSTGRES_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Authentication secret
- At least one LLM provider API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)

Optional but recommended:
- `EXA_API_KEY` - For web search functionality
- OAuth provider credentials for social login

Use `pnpm docker:pg` for quick PostgreSQL setup during development.

## Code Style

- Uses Biome for formatting and linting
- TypeScript with strict mode enabled
- 2-space indentation, double quotes for strings
- Path aliases configured in tsconfig.json
- Follow existing patterns for component structure and naming

## Testing Requirements

For E2E tests:
- PostgreSQL database running
- Environment variables configured
- Use `pnpm test:e2e` for full test suite
- Individual test files can be run with specific paths
- while doing enhancements or add new functionality without impacting the existing functionality
- maintain the current folder structure and don't create any subfolders