type LlmProxyParams = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

declare global {
  interface Window {
    electronAPI?: {
      llm?: {
        call?: (params: LlmProxyParams) => Promise<{ body: string; status: number }>;
      };
    };
  }
}

window.electronAPI = {
  ...(window.electronAPI ?? {}),
  llm: {
    ...(window.electronAPI?.llm ?? {}),
    call: async (params: LlmProxyParams) => {
      const response = await fetch('/__mobile_preview/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    },
  },
};

export {};
