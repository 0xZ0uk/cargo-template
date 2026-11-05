export interface PayloadGlobalAdapterConfig {
  /** Slug for the Payload Global that stores the manifest. Default: '_abManifest' */
  globalSlug?: string;
  /**
   * Server URL used to fetch the global via REST when the resolver has no `payload` to read
   * through (it runs in another process). Example: 'https://example.com'
   */
  serverURL?: string;
  /** Payload API route prefix. Default: '/api' */
  apiRoute?: string;
}
