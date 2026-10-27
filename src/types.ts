export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DFS_LOGIN: string;
  DFS_PASSWORD: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  DFS_MODE?: string; // standard | live
  DFS_SANDBOX?: string; // "1" to use sandbox.dataforseo.com (free, fake data)
  DFS_BASE?: string; // override API base (testing)
  AI?: Ai; // Workers AI (semantic clustering)
  // Rank & Rent module (all optional)
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_BASE?: string; // override (testing)
  GSC_SERVICE_ACCOUNT?: string; // full service-account JSON key
  GSC_API_BASE?: string; // override (testing)
  RESEND_API_KEY?: string;
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export interface RrSite {
  id: number;
  domain: string;
  niche: string;
  city_id: number | null;
  country: string;
  theme: string;
  launch_date: string | null;
  status: string;
  tracking_phone: string;
  twilio_number: string;
  forward_to: string;
  lead_destination: string;
  tenant_name: string;
  tenant_contact: string;
  monthly_rent: number;
  currency: string;
  rent_paid_until: string | null;
  domain_expiry: string | null;
  gsc_property: string;
  key_pages: string;
  uptime_url: string;
  form_test_url: string;
  lead_secret: string;
  notes: string;
}

export interface Project {
  id: number;
  name: string;
  domain: string;
  brand_names: string;
  competitors: string;
  location_code: number;
  language_code: string;
  device: string;
  depth: number;
  frequency: string;
  business_name: string;
  place_cid: string;
  notes: string;
}

export interface Keyword {
  id: number;
  project_id: number;
  keyword: string;
  tags: string;
  engines: string;
}
