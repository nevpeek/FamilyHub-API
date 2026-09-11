const { google } = require("googleapis");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

function getGoogleOAuthClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  } = process.env;

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI
  ) {
    throw new Error(
      "Google Calendar OAuth environment variables are not configured"
    );
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function getGoogleAuthUrl(state = null) {
  const oauth2Client = getGoogleOAuthClient();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    ...(state ? { state } : {}),
  });
}

function applyGoogleConnectionCredentials(
  oauth2Client,
  connection,
  onTokens = null
) {
  oauth2Client.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token,
    expiry_date: connection.token_expiry,
  });

  if (typeof onTokens === "function") {
    oauth2Client.on("tokens", (tokens) => {
      onTokens(tokens);
    });
  }

  return oauth2Client;
}

async function getGoogleAccountInfo(
  oauth2Client
) {
  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client,
  });

  const response =
    await calendar.calendarList.get({
      calendarId: "primary",
    });

  return {
    googleAccountId: response.data.id,
    email: response.data.id,
  };
}

async function fetchGoogleCalendarEvents(
  oauth2Client,
  calendarId,
  {
    timeMin,
    timeMax,
  } = {}
) {
  const calendar = google.calendar({
    version: "v3",
    auth: oauth2Client,
  });

  const events = [];
  let pageToken = null;

  do {
    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken,
    });

    events.push(
      ...(response.data.items || [])
    );

    pageToken =
      response.data.nextPageToken || null;
  } while (pageToken);

  return events;
}

module.exports = {
  GOOGLE_SCOPES,
  getGoogleOAuthClient,
  getGoogleAuthUrl,
  applyGoogleConnectionCredentials,
  getGoogleAccountInfo,
  fetchGoogleCalendarEvents,
};