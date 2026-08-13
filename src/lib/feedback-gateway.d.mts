export type FeedbackKind = "review" | "complaint";
export type FeedbackGatewayResult = { status: number; payload: { ok: boolean; error?: string } };
export const FEEDBACK_BODY_LIMIT_BYTES: number;
export const TURNSTILE_VERIFY_URL: string;
export class FeedbackGatewayError extends Error {
  code: string;
  status: number;
}
export function feedbackGatewayConfig(env?: NodeJS.ProcessEnv): {
  production: boolean;
  allowedOrigin: string;
  proxyMode: "local" | "cloudflare";
  turnstileSecret: string;
  turnstileExpectedHostname: string;
  fingerprintSecret: string;
};
export function safeFeedbackResponse(error: unknown): FeedbackGatewayResult;
export function executeFeedbackGateway(input: {
  request: Request;
  kind: FeedbackKind;
  actorId?: string | null;
  databaseSubmitter(input: {
    feedbackType: FeedbackKind;
    targetId: string;
    actorId: string | null;
    networkFingerprint: string;
    idempotencyKeyHash: string;
    payloadHash: string;
    body: string | null;
    contact: string | null;
    wouldHireAgain: boolean | null;
    reason: string | null;
    description: string | null;
    materials: string | null;
  }): Promise<{ data: unknown; error: unknown }>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  testDependencies?: boolean;
  testCaptchaVerifier?: (input: { token: string; action: string; idempotencyKey: string }) => Promise<boolean>;
}): Promise<FeedbackGatewayResult>;
