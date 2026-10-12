/** Declarative form field, used by integration config and miniapp settings. Values live in `Record<string, unknown>`. */
interface FieldBase {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
}

export type FieldSpec =
  | (FieldBase & { type: 'text' | 'password'; placeholder?: string })
  | (FieldBase & { type: 'number'; min?: number; max?: number; step?: number; unit?: string })
  | (FieldBase & { type: 'select'; options: { value: string; label: string; disabled?: boolean }[] })
  | (FieldBase & { type: 'checkbox' })
  /** Destination picker backed by an integration's `autocomplete` client method. Value: {@link PlaceValue}. */
  | (FieldBase & { type: 'place'; integration: string });

export interface PlaceValue {
  placeId: string;
  label: string;
}

export type Values = Record<string, unknown>;

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type AuthSpec =
  | { kind: 'apiKey' }
  | { kind: 'oauthPkce'; scopes: string[] };

export interface Integration<Client = unknown> {
  id: string;
  name: string;
  description: string;
  configFields: FieldSpec[];
  auth: AuthSpec;
  /** True when the integration can serve requests (key present / tokens obtained). */
  isReady(cfg: Values, tokens?: StoredTokens): boolean;
  /** Extra read-only facts to show in the UI (e.g. the OAuth redirect URI). */
  info?(): { label: string; value: string }[];
  /** Starts interactive auth (OAuth redirects away from the page). */
  connect?(cfg: Values): Promise<void>;
  /** Called on app load; returns true when the current URL was an auth callback it consumed. */
  handleRedirect?(cfg: Values): Promise<boolean>;
  /** Validates the stored credentials against the real service; resolves with a human readable result. */
  test?(cfg: Values): Promise<string>;
  getClient(cfg: Values): Client;
}
