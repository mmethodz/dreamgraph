# Architect Configuration

> Defines the configuration for the Architect LLM provider, including the model type, API key, and base URL. This configuration is essential for orchestrating LLM calls.

**Table:** `architect_config`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| provider | string | The LLM provider, such as 'anthropic', 'openai', or 'ollama'. |
| model | string | The specific model to use from the selected provider. |
| baseUrl | string | The base URL for the LLM API. |
| apiKey | string | The API key for authenticating requests to the LLM provider. |

