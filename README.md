

**Neogen Chatbot** - A better open-source AI chatbot for individuals and teams, inspired by ChatGPT, Claude, Grok, and Gemini.

• **Multi-AI Support** - Integrates all major LLMs: OpenAI, Anthropic, Google, xAI, Ollama, and more  
• **Powerful Tools** - MCP protocol, web search, JS/Python code execution, data visualization  
• **Automation** - Custom agents, visual workflows, artifact generation  
• **Collaboration** - Share agents, workflows, and MCP configurations with your team  
• **Voice Assistant** - Realtime voice chat with full MCP tool integration  
• **Intuitive UX** - Instantly invoke any feature with `@mention`  
• **Quick Start** - Deploy free with Vercel Deploy button  

Built with Vercel AI SDK and Next.js, combining the best features of leading AI services into one platform.


### Quick Start 🚀

```bash
# 1. Clone the repository

git clone https://github.com/lpanigrahi/neogen-chatbot.git
cd neogen-chatbot

# 2. (Optional) Install pnpm if you don't have it

npm install -g pnpm

# 3. Install dependencies

pnpm i

# 4. (Optional) Start a local PostgreSQL instance

pnpm docker:pg

# If you already have your own PostgreSQL running, you can skip this step.
# In that case, make sure to update the PostgreSQL URL in your .env file.

# 5. Enter required information in the .env file

# The .env file is created automatically. Just fill in the required values.
# For the fastest setup, provide at least one LLM provider's API key (e.g., OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY, etc.) and the PostgreSQL URL you want to use.

# 6. Start the server

pnpm build:local && pnpm start

# (Recommended for most cases. Ensures correct cookie settings.)
# For development mode with hot-reloading and debugging, you can use:
# pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to get started.

