/* ============================================================
   Kingdom 3914 website settings — the only file you need to edit
   ============================================================ */
window.CONFIG = {
  KINGDOM: "Kingdom 3914",
  TAGLINE: "RB3 League",

  // Paste your Google Apps Script "Web app" URL between the quotes.
  // While it is empty, the site runs in DEMO mode with sample data.
  API_URL: "https://script.google.com/macros/s/AKfycbyDJgInlCXr3p1SOmyobID0Ba1c2eJ8d_IYCBC8aJmsOCxkEgr3SF9mXHdiNF7l/exec",

  // Optional: your Discord invite link (shows a button on Home)
  DISCORD: "",

  // How often pages refresh bids and news (seconds)
  REFRESH_SECONDS: 15,

  // Bidding rules shown on the MGE & GH page
  RULES: [
    "Sign in with your governor ID and the PIN given to you by the officers. Never share your PIN.",
    "You can only bid with your available credits. Credits are reserved while you lead a rank.",
    "If someone outbids you, your credits are released straight away.",
    "Each new bid must beat the current bid by the event's minimum step.",
    "The highest bid when the timer ends wins the rank, and the credits are spent.",
    "Bidding for another governor is not allowed. Officers can cancel any bid that breaks kingdom rules.",
    "Every bid is recorded and cannot be deleted."
  ]
};
