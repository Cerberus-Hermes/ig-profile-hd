export const dynamic = "force-dynamic";

export async function GET() {
  const hasSession = !!process.env.INSTAGRAM_SESSION_ID;
  return Response.json({
    has_session: hasSession,
  });
}
