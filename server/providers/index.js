const { DeepSeekProvider } = require('./deepseek-provider');

function createProviderRegistry(config, options = {}) {
  const deepseek = new DeepSeekProvider({
    apiKey: config.deepseekApiKey,
    endpoint: config.deepseekEndpoint,
    model: config.deepseekModel,
    timeoutMs: config.providerTimeoutMs,
    fetch: options.fetch
  });
  const providers = new Map([[deepseek.name, deepseek]]);
  return {
    get: (name) => providers.get(name),
    configured: () => [...providers.values()].filter((provider) => provider.configured),
    status: () => [...providers.values()].map((provider) => ({ platform: provider.name, configured: provider.configured, model: provider.model, mode: provider.configured ? 'live' : 'unconfigured' }))
  };
}

module.exports = { createProviderRegistry };
