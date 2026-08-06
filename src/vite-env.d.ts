/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SERVER_FUNCTION_URL?: string;
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  readonly VITE_TELEGRAM_APP_SHORT_NAME?: string;
  readonly VITE_USE_MOCK_TELEGRAM?: string;
  readonly VITE_MOCK_INIT_DATA?: string;
  readonly VITE_USE_MOCK_API?: string;
}

interface ImportMeta { readonly env: ImportMetaEnv }
