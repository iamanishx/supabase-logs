import {
  SendEmailCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";

const SEVERITY_LEVELS = ["error", "fatal", "panic"];

const sesClient = new SESv2Client({
  region: Deno.env.get("AWS_REGION") || "us-east-1",
  credentials: {
    accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") || "",
    secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") || "",
  },
});

const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "alerts@yourcompany.com";
const TO_EMAILS = (Deno.env.get("ALERT_EMAILS") || "admin@yourcompany.com")
  .split(",");
const PROJECT_REF = Deno.env.get("SUPABASE_PROJECT_REF") || "";
const ACCESS_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") || "";
const ALLOWED_FUNCTION_IDS = (Deno.env.get("ALLOWED_FUNCTION_IDS") || "")
  .split(",")
  .filter(Boolean);

const CHECK_INTERVAL_MINUTES = parseInt(
  Deno.env.get("CHECK_INTERVAL_MINUTES") || "15",
);

let lastCheckTime = new Date(Date.now() - CHECK_INTERVAL_MINUTES * 60 * 1000);

interface LogEntry {
  timestamp: string;
  event_message: string;
  event_type?: string;
  function_id?: string;
  level?: string;
  id?: string;
}

async function fetchLogs(): Promise<LogEntry[]> {
  const now = new Date();
  const startTime = lastCheckTime.toISOString();
  const endTime = now.toISOString();

  const sql = `
    SELECT 
      timestamp,
      event_message,
      event_type,
      metadata.parsed.function_id as function_id,
      metadata.parsed.level as level,
      id
    FROM edge_logs
    WHERE timestamp > '${startTime}'
      AND timestamp <= '${endTime}'
      AND metadata.parsed.level IN ('error', 'fatal', 'panic')
    ORDER BY timestamp DESC
  `;

  const url =
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.result || [];
}

function shouldAlert(log: LogEntry): boolean {
  const level = log.level?.toLowerCase() || "";
  if (!SEVERITY_LEVELS.includes(level)) {
    return false;
  }

  if (
    ALLOWED_FUNCTION_IDS.length > 0 &&
    !ALLOWED_FUNCTION_IDS.includes(log.function_id || "")
  ) {
    return false;
  }

  return true;
}

async function sendEmailAlert(log: LogEntry): Promise<void> {
  const level = log.level || "unknown";
  const functionId = log.function_id || "unknown";
  const functionName = functionId.substring(0, 8);

  const subject = `[${level.toUpperCase()}] Edge Function Alert - ${functionName}`;

  const htmlContent = `
    <h2>Supabase Edge Function Alert</h2>
    <p><strong>Level:</strong> ${level.toUpperCase()}</p>
    <p><strong>Function ID:</strong> ${functionId}</p>
    <p><strong>Event Type:</strong> ${log.event_type || "N/A"}</p>
    <p><strong>Timestamp:</strong> ${log.timestamp}</p>
    <p><strong>Message:</strong></p>
    <pre style="background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto;">${log.event_message}</pre>
  `;

  const textContent = `
Supabase Edge Function Alert
Level: ${level.toUpperCase()}
Function ID: ${functionId}
Event Type: ${log.event_type || "N/A"}
Timestamp: ${log.timestamp}
Message: ${log.event_message}
  `.trim();

  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: TO_EMAILS },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlContent, Charset: "UTF-8" },
            Text: { Data: textContent, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}

async function checkLogs(): Promise<{ processed: number; alerts_sent: number }> {
  console.log(`Checking logs from ${lastCheckTime.toISOString()}`);

  const logs = await fetchLogs();
  console.log(`Found ${logs.length} severe logs`);

  const alertPromises: Promise<void>[] = [];

  for (const log of logs) {
    if (shouldAlert(log)) {
      console.log(`Alerting for log: ${log.id}`);
      alertPromises.push(sendEmailAlert(log));
    }
  }

  if (alertPromises.length > 0) {
    await Promise.all(alertPromises);
    console.log(`Sent ${alertPromises.length} alerts`);
  }

  lastCheckTime = new Date();

  return {
    processed: logs.length,
    alerts_sent: alertPromises.length,
  };
}

const handler = async (request: Request): Promise<Response> => {
  try {
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const result = await checkLogs();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Log check completed",
        ...result,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
Deno.serve(handler);
