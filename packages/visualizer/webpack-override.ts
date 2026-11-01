import type { WebpackOverrideFn } from "@remotion/bundler";

// packages/shared keeps NodeNext ".js" specifiers for the worker's ESM; webpack reads them as
// the .ts sources.
export const withSharedSources: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
});
