import { createClient } from "@supabase/supabase-js";

const PAYMENT_BUCKET = "ideaforge-payment-proofs";
const INITIAL_MEMBER_COUNT = 2;
const MAX_MEMBER_COUNT = 4;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey && !supabaseAnonKey.startsWith("your-")
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const publicView = document.querySelector("#public-view");
const adminView = document.querySelector("#admin-view");
const teamForm = document.querySelector("#team-form");
const paymentForm = document.querySelector("#payment-form");
const successPanel = document.querySelector("#registration-success");
const membersList = document.querySelector("#members-list");
const toast = document.querySelector("#toast");
const adminToast = document.querySelector("#admin-toast");

let draftTeam = null;
let memberCount = INITIAL_MEMBER_COUNT;
let selectedScreenshot = null;
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function showToast(message, isAdmin = false) {
  const element = isAdmin ? adminToast : toast;
  if (!element) return;
  element.textContent = message;
  element.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("visible"), 4200);
}

function renderMembers() {
  membersList.innerHTML = "";
  for (let index = 0; index < memberCount; index += 1) {
    const card = document.createElement("section");
    card.className = "member-card";
    card.innerHTML = `
      <div class="member-card-top"><span>Member ${index + 1}</span><span>${index === 0 ? "TEAM CONTACT" : "PARTICIPANT"}</span></div>
      <div class="member-fields">
        <div><label class="field-label" for="member-${index}-name">Full name <span>*</span></label><input class="text-input" id="member-${index}-name" name="memberName" autocomplete="name" maxlength="100" required /></div>
        <div><label class="field-label" for="member-${index}-college">College name <span>*</span></label><input class="text-input" id="member-${index}-college" name="memberCollege" maxlength="120" required /></div>
        <div><label class="field-label" for="member-${index}-mobile">Mobile number <span>*</span></label><input class="text-input" id="member-${index}-mobile" name="memberMobile" type="tel" inputmode="tel" autocomplete="tel" minlength="7" maxlength="18" title="Enter a valid mobile number" required /></div>
        <div><label class="field-label" for="member-${index}-email">Gmail address <span>*</span></label><input class="text-input" id="member-${index}-email" name="memberEmail" type="email" autocomplete="email" maxlength="254" pattern="[^@\\s]+@gmail\\.com" title="Please enter a Gmail address ending in @gmail.com" required /></div>
      </div>`;
    membersList.append(card);
  }
  document.querySelector("#member-count").textContent = `${memberCount} / ${MAX_MEMBER_COUNT}`;
  document.querySelector("#add-member").disabled = memberCount >= MAX_MEMBER_COUNT;
  document.querySelector("#remove-member").disabled = memberCount <= INITIAL_MEMBER_COUNT;
}

function refreshRegistrationState() {
  const setup = document.querySelector("#registration-setup");
  const configError = document.querySelector("#registration-config-error");
  const closed = document.querySelector("#registration-closed");
  setup.hidden = true;
  configError.hidden = true;
  closed.hidden = true;
  teamForm.hidden = true;
  paymentForm.hidden = true;

  if (!supabase) {
    configError.hidden = false;
    document.querySelector("#registration-config-message").textContent =
      "The Supabase URL and anon key are not configured for this deployment.";
    return;
  }

  setup.hidden = false;
  setup.querySelector("strong").textContent = "Checking registration…";
  setup.querySelector("p").textContent = "Please wait while we check the event status.";
  const connectionTimeout = window.setTimeout(() => {
    setup.hidden = true;
    configError.hidden = false;
    document.querySelector("#registration-config-message").textContent =
      "Supabase is taking too long to respond. Please try again later.";
  }, 10000);

  supabase
    .from("ideaforge_settings")
    .select("registration_open")
    .eq("id", true)
    .single()
    .then(({ data, error }) => {
      window.clearTimeout(connectionTimeout);
      setup.hidden = true;
      if (error) {
        console.error("Could not check IdeaForge registration status.", error);
        configError.hidden = false;
        document.querySelector("#registration-config-message").textContent =
          "We could not check registration status. Please try again later.";
        return;
      }

      const isOpen = data.registration_open;
      closed.hidden = isOpen;
      teamForm.hidden = !isOpen || Boolean(draftTeam) || !successPanel.hidden;
      paymentForm.hidden = !isOpen || !draftTeam || !successPanel.hidden;
    })
    .catch((error) => {
      window.clearTimeout(connectionTimeout);
      console.error("Could not reach IdeaForge registration settings.", error);
      setup.hidden = true;
      configError.hidden = false;
      document.querySelector("#registration-config-message").textContent =
        "We could not reach registration services. Please try again later.";
    });
}

function getMembersFromForm() {
  const values = new FormData(teamForm);
  const names = values.getAll("memberName");
  const colleges = values.getAll("memberCollege");
  const mobiles = values.getAll("memberMobile");
  const emails = values.getAll("memberEmail");
  return names.map((name, index) => ({
    name: String(name).trim(),
    college: String(colleges[index]).trim(),
    mobile: String(mobiles[index]).trim(),
    email: String(emails[index]).trim(),
  }));
}

function resetRegistrationForm() {
  teamForm.reset();
  paymentForm.reset();
  draftTeam = null;
  if (selectedScreenshot?.previewUrl) {
    URL.revokeObjectURL(selectedScreenshot.previewUrl);
  }
  selectedScreenshot = null;
  memberCount = INITIAL_MEMBER_COUNT;
  renderMembers();
  document.querySelector("#screenshot-preview").hidden = true;
  document.querySelector("#screenshot-preview").textContent = "";
  teamForm.hidden = false;
  paymentForm.hidden = true;
  successPanel.hidden = true;
  refreshRegistrationState();
}

document.querySelector("#add-member").addEventListener("click", () => {
  if (memberCount < MAX_MEMBER_COUNT) {
    memberCount += 1;
    renderMembers();
  }
});

document.querySelector("#remove-member").addEventListener("click", () => {
  if (memberCount > INITIAL_MEMBER_COUNT) {
    memberCount -= 1;
    renderMembers();
  }
});

teamForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!teamForm.reportValidity()) return;
  if (!supabase) {
    showToast("Registration services are not configured yet.");
    return;
  }
  const members = getMembersFromForm();
  if (members.length < INITIAL_MEMBER_COUNT || members.length > MAX_MEMBER_COUNT) {
    showToast("A team must have between 2 and 4 members.");
    return;
  }
  const submitButton = teamForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.dataset.originalText = submitButton.innerHTML;
  submitButton.textContent = "Saving team…";
  try {
    const { data: teamId, error } = await supabase.rpc("ideaforge_register_team", {
      p_team_name: String(new FormData(teamForm).get("teamName")).trim(),
      p_members: members.map((member) => ({
        full_name: member.name,
        college_name: member.college,
        mobile_number: member.mobile,
        email: member.email,
      })),
    });

    if (error) {
      console.error("IdeaForge team registration failed.", error);
      showToast(error.message || "Could not save your team. Please try again.");
      return;
    }

    draftTeam = {
      id: teamId,
      teamName: String(new FormData(teamForm).get("teamName")).trim(),
      members,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Unexpected error while registering IdeaForge team.", error);
    showToast("Could not save your team because of a network error. Please try again.");
    return;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitButton.dataset.originalText;
  }

  document.querySelector("#payment-team-summary").textContent =
    `${draftTeam.teamName} · ${members.length} members · Team contact: ${members[0].name}`;
  teamForm.hidden = true;
  paymentForm.hidden = false;
  paymentForm.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.querySelector("#back-to-team").addEventListener("click", () => {
  paymentForm.hidden = true;
  teamForm.hidden = false;
});

document.querySelector("#payment-screenshot").addEventListener("change", (event) => {
  const file = event.currentTarget.files?.[0];
  const preview = document.querySelector("#screenshot-preview");
  if (!file) {
    selectedScreenshot = null;
    preview.hidden = true;
    return;
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    event.currentTarget.value = "";
    showToast("Choose a PNG, JPG, or WEBP image.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    event.currentTarget.value = "";
    showToast("The screenshot must be 5 MB or smaller.");
    return;
  }
  if (selectedScreenshot?.previewUrl) {
    URL.revokeObjectURL(selectedScreenshot.previewUrl);
  }
  const previewUrl = URL.createObjectURL(file);
  selectedScreenshot = { file, name: file.name, previewUrl, storagePath: null };
  preview.replaceChildren();
  const label = document.createElement("span");
  label.textContent = `Selected: ${file.name}`;
  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = "Preview of the selected payment screenshot";
  preview.append(label, image);
  preview.hidden = false;
});

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!paymentForm.reportValidity()) return;
  if (!draftTeam || !selectedScreenshot) {
    showToast("Add the payment screenshot before submitting.");
    return;
  }
  if (!supabase) {
    showToast("Registration services are not configured yet.");
    return;
  }
  const utr = String(new FormData(paymentForm).get("utr")).trim();
  const submitButton = paymentForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.dataset.originalText = submitButton.innerHTML;
  submitButton.textContent = "Uploading payment proof…";

  try {
    if (!selectedScreenshot.storagePath) {
      const safeFileName = selectedScreenshot.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      selectedScreenshot.storagePath =
        `${draftTeam.id}/${crypto.randomUUID()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_BUCKET)
        .upload(selectedScreenshot.storagePath, selectedScreenshot.file, {
          cacheControl: "3600",
          contentType: selectedScreenshot.file.type,
          upsert: false,
        });

      if (uploadError) {
        selectedScreenshot.storagePath = null;
        console.error("IdeaForge payment screenshot upload failed.", uploadError);
        showToast(uploadError.message || "Could not upload the screenshot. Please try again.");
        return;
      }
    }

    const { error } = await supabase.rpc("ideaforge_submit_payment", {
      p_team_id: draftTeam.id,
      p_utr: utr,
      p_screenshot_path: selectedScreenshot.storagePath,
    });

    if (error) {
      console.error("IdeaForge payment submission failed.", error);
      showToast(error.message || "Could not submit payment details. Please try again.");
      return;
    }

    const teamName = draftTeam.teamName;
    document.querySelector("#success-message").textContent =
      `${teamName} has been registered. Your payment screenshot is securely uploaded and awaiting admin review.`;
    if (selectedScreenshot.previewUrl) {
      URL.revokeObjectURL(selectedScreenshot.previewUrl);
    }
    draftTeam = null;
    selectedScreenshot = null;
    paymentForm.hidden = true;
    successPanel.hidden = false;
    successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    console.error("Unexpected error while submitting IdeaForge payment details.", error);
    showToast("Could not submit payment details because of a network error. Please try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitButton.dataset.originalText;
  }
});

let activeAdmin = null;

function showAdminConnectionError(message) {
  document.querySelector("#admin-connection-error").hidden = false;
  document.querySelector("#admin-connection-message").textContent = message;
}

function showAdminLogin(message) {
  document.querySelector("#admin-dashboard").hidden = true;
  document.querySelector("#admin-connection-error").hidden = true;
  document.querySelector("#admin-login-panel").hidden = false;
  document.querySelector("#admin-login-message").textContent = message;
  document.querySelector("#admin-sign-out").hidden = true;
}

async function renderAdmin() {
  const loginPanel = document.querySelector("#admin-login-panel");
  const dashboard = document.querySelector("#admin-dashboard");
  const connectionError = document.querySelector("#admin-connection-error");
  const signOutButton = document.querySelector("#admin-sign-out");

  loginPanel.hidden = true;
  dashboard.hidden = true;
  connectionError.hidden = true;

  if (!supabase) {
    showAdminConnectionError("Supabase is not configured for this deployment.");
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error("Could not read IdeaForge admin session.", sessionError);
    showAdminConnectionError("Could not check your sign-in. Please reload and try again.");
    return;
  }

  if (!sessionData.session) {
    activeAdmin = null;
    showAdminLogin("Sign in with your approved Google account to manage the hackathon.");
    return;
  }

  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_ideaforge_admin");
  if (adminCheckError) {
    console.error("Could not verify IdeaForge admin access.", adminCheckError);
    showAdminConnectionError("Could not verify admin access. Confirm that the database schema is installed.");
    return;
  }

  if (!isAdmin) {
    await supabase.auth.signOut();
    activeAdmin = null;
    showAdminLogin("This Google account is not approved for IdeaForge admin access.");
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    console.error("Could not read the signed-in IdeaForge admin.", userError);
    showAdminConnectionError("Could not read your admin profile. Please sign in again.");
    return;
  }

  activeAdmin = userData.user;
  signOutButton.hidden = false;
  dashboard.hidden = false;
  await loadAdminDashboard();
}

async function loadAdminDashboard() {
  if (!activeAdmin) return;

  const [settingsResult, teamsResult, emailResult] = await Promise.all([
    supabase
      .from("ideaforge_settings")
      .select("registration_open")
      .eq("id", true)
      .single(),
    supabase
      .from("ideaforge_teams")
      .select("id, team_name, payment_status, payment_utr, screenshot_path, created_at, ideaforge_members(id, full_name, college_name, mobile_number, email, is_team_contact)")
      .order("created_at", { ascending: false }),
    supabase
      .from("ideaforge_email_outbox")
      .select("id, team_id, status, attempt_count, retryable, last_error, sent_at"),
  ]);

  if (settingsResult.error) {
    console.error("Could not read IdeaForge admin settings.", settingsResult.error);
    showAdminConnectionError("Could not load registration status. Check your schema and admin permissions.");
    return;
  }
  if (teamsResult.error) {
    console.error("Could not load IdeaForge registrations.", teamsResult.error);
    showAdminConnectionError("Could not load registrations. Check your schema and admin permissions.");
    return;
  }
  if (emailResult.error) {
    console.error("Could not load IdeaForge confirmation-email status.", emailResult.error);
    showAdminConnectionError("Could not load email status. Apply the IdeaForge email migration and check admin permissions.");
    return;
  }

  const teams = teamsResult.data ?? [];
  const emailByTeam = new Map(
    (emailResult.data ?? []).map((row) => [row.team_id, row]),
  );
  const membersCount = teams.reduce(
    (total, team) => total + (team.ideaforge_members?.length ?? 0),
    0,
  );
  document.querySelector("#total-teams").textContent = String(teams.length);
  document.querySelector("#total-members").textContent = String(membersCount);
  document.querySelector("#pending-payments").textContent =
    String(teams.filter((team) => team.payment_status === "pending_review").length);
  document.querySelector("#approved-payments").textContent =
    String(teams.filter((team) => team.payment_status === "approved").length);

  const toggle = document.querySelector("#toggle-registration");
  toggle.textContent = settingsResult.data.registration_open ? "Close registration" : "Open registration";
  toggle.dataset.open = String(settingsResult.data.registration_open);

  const list = document.querySelector("#admin-team-list");
  list.replaceChildren();
  document.querySelector("#admin-empty").hidden = teams.length > 0;

  for (const team of teams) {
    const members = team.ideaforge_members ?? [];
    const statusLabels = {
      awaiting_payment: "AWAITING PAYMENT",
      pending_review: "PENDING REVIEW",
      approved: "APPROVED",
      rejected: "REJECTED",
    };
    const isPending = team.payment_status === "pending_review";
    const email = emailByTeam.get(team.id);
    let screenshotUrl = null;

    if (team.screenshot_path) {
      const { data, error } = await supabase.storage
        .from(PAYMENT_BUCKET)
        .createSignedUrl(team.screenshot_path, 300);
      if (error) {
        console.error(`Could not open screenshot for team ${team.id}.`, error);
      } else {
        screenshotUrl = data.signedUrl;
      }
    }

    const membersHtml = members.map((member) => `
      <div class="admin-member-row">
        <strong>${escapeHtml(member.full_name)}${member.is_team_contact ? " · Team contact" : ""}</strong>
        <span>${escapeHtml(member.college_name)} · ${escapeHtml(member.mobile_number)}</span>
        <span>${escapeHtml(member.email)}</span>
      </div>`).join("");
    const paymentHtml = team.payment_utr
      ? `<h4>PAYMENT / UTR</h4>
         <span class="utr-value">${escapeHtml(team.payment_utr)}</span>
         ${screenshotUrl
           ? `<a href="${escapeHtml(screenshotUrl)}" target="_blank" rel="noopener noreferrer"><img class="payment-image" src="${escapeHtml(screenshotUrl)}" alt="Payment screenshot for ${escapeHtml(team.team_name)}" /></a>`
           : `<p class="prototype-note">Screenshot unavailable. Check the private bucket and its admin policy.</p>`}`
      : "<h4>PAYMENT</h4><span class=\"prototype-note\">Payment proof not submitted yet.</span>";
    const emailStatusLabels = {
      pending: "Queued",
      sending: "Sending",
      sent: "Accepted by Gmail",
      failed: "Needs attention",
    };
    const emailStatus = email
      ? `${emailStatusLabels[email.status] ?? "Unknown"} · ${email.attempt_count} attempt${email.attempt_count === 1 ? "" : "s"}`
      : team.payment_status === "approved"
        ? "Queue record missing"
        : team.payment_status === "rejected"
          ? "Not sent — payment was rejected"
          : "Queued automatically after payment approval";
    const emailError = email?.last_error
      ? `<p class="prototype-note">${escapeHtml(email.last_error)}</p>`
      : "";
    const emailDeliveryNote = email?.status === "sent"
      ? '<p class="prototype-note">Gmail accepted the message; inbox delivery is not confirmed.</p>'
      : "";
    const card = document.createElement("article");
    card.className = "admin-team-card";
    card.innerHTML = `
      <div class="admin-team-header">
        <div><h3>${escapeHtml(team.team_name)}</h3><p>${members.length} participants · Registered ${new Date(team.created_at).toLocaleString()}</p></div>
        <span class="status-pill ${team.payment_status === "approved" ? "approved" : ""}">${statusLabels[team.payment_status] ?? "UNKNOWN"}</span>
      </div>
      <div class="admin-team-body"><section><h4>MEMBER PROFILES</h4>${membersHtml}</section><section>${paymentHtml}</section><section><h4>EMAIL CONFIRMATION</h4><span class="prototype-note">${emailStatus}</span>${emailError}${emailDeliveryNote}</section></div>
      <div class="admin-actions">
        ${isPending ? `<button class="small-button approve" type="button" data-action="approve" data-team-id="${escapeHtml(team.id)}">Verify &amp; approve payment</button><button class="small-button" type="button" data-action="reject" data-team-id="${escapeHtml(team.id)}">Reject payment</button>` : ""}
        ${email?.status === "failed" && email.retryable ? `<button class="small-button" type="button" data-action="retry-email" data-email-id="${escapeHtml(email.id)}">Retry confirmation</button>` : ""}
      </div>`;
    list.append(card);
  }
}

document.querySelector("#admin-google-sign-in").addEventListener("click", async (event) => {
  if (!supabase) {
    showAdminLogin("Supabase is not configured for this deployment.");
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Opening Google…";
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    if (error) {
      console.error("Google sign-in could not be started.", error);
      showAdminLogin("Google sign-in could not be started. Please try again.");
    }
  } catch (error) {
    console.error("Unexpected error starting Google sign-in.", error);
    showAdminLogin("Google sign-in could not be started. Please try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Continue with Google <span>↗</span>';
  }
});

document.querySelector("#admin-sign-out").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Could not sign out IdeaForge admin.", error);
    showToast("Could not sign out. Please try again.", true);
    return;
  }
  activeAdmin = null;
  showAdminLogin("You have signed out.");
});

document.querySelector("#toggle-registration").addEventListener("click", async (event) => {
  if (!activeAdmin) {
    showToast("Sign in with an approved admin account first.", true);
    return;
  }
  const button = event.currentTarget;
  const nextOpen = button.dataset.open !== "true";
  button.disabled = true;
  try {
    const { error } = await supabase
      .from("ideaforge_settings")
      .update({
        registration_open: nextOpen,
        updated_at: new Date().toISOString(),
        updated_by: activeAdmin.id,
      })
      .eq("id", true);
    if (error) {
      console.error("Could not update IdeaForge registration status.", error);
      showToast(error.message || "Could not update registration status.", true);
      return;
    }
    await loadAdminDashboard();
    showToast(`Registration ${nextOpen ? "opened" : "closed"}.`, true);
  } catch (error) {
    console.error("Unexpected error updating registration status.", error);
    showToast("Could not update registration status because of a network error.", true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-team-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !activeAdmin) return;
  if (button.dataset.action === "retry-email") {
    button.disabled = true;
    const { data, error } = await supabase.rpc("ideaforge_email_retry", {
      p_id: button.dataset.emailId,
    });
    if (error) {
      console.error("Could not retry IdeaForge confirmation email.", error);
      showToast(error.message || "Could not retry the confirmation email.", true);
      button.disabled = false;
      return;
    }
    if (data !== true) {
      await loadAdminDashboard();
      showToast("This email is no longer eligible for a safe retry.", true);
      return;
    }
    await loadAdminDashboard();
    showToast("Confirmation email queued for retry.", true);
    return;
  }

  button.disabled = true;
  const decision = button.dataset.action === "approve" ? "approved" : "rejected";
  const { error } = await supabase.rpc("ideaforge_review_payment", {
    p_team_id: button.dataset.teamId,
    p_decision: decision,
    p_note: null,
  });
  if (error) {
    console.error(`Could not ${decision} IdeaForge payment.`, error);
    showToast(error.message || `Could not ${decision} payment.`, true);
    button.disabled = false;
    return;
  }
  await loadAdminDashboard();
  showToast(`Payment ${decision}.`, true);
});

function isAdminRoute() {
  return window.location.pathname.replace(/\/+$/, "").endsWith("/wasd4381") ||
    window.location.search === "?admin=wasd4381" ||
    window.location.hash === "#admin";
}

function renderRoute() {
  const admin = isAdminRoute();
  publicView.hidden = admin;
  adminView.hidden = !admin;
  if (admin) void renderAdmin();
  else refreshRegistrationState();
}

window.addEventListener("popstate", renderRoute);
window.addEventListener("hashchange", renderRoute);

renderMembers();
renderRoute();

if ("IntersectionObserver" in window) {
  document.documentElement.classList.add("has-motion");
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll(".reveal").forEach((element) => {
    revealObserver.observe(element);
  });
}
