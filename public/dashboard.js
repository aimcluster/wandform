const fieldsContainer = document.getElementById("fields");
const createForm = document.getElementById("create-form");
const addFieldButton = document.getElementById("add-field");
const createResult = document.getElementById("create-result");

const roomStatus = document.getElementById("room-status");
const roomIdInput = document.getElementById("room-id");
const actorNameInput = document.getElementById("actor-name");
const connectRoomButton = document.getElementById("connect-room");
const notifyUpdateButton = document.getElementById("notify-update");
const presenceCount = document.getElementById("presence-count");
const lastUpdate = document.getElementById("last-update");

const availableFieldTypes = ["text", "email", "number", "textarea", "select", "checkbox"];

let fieldState = [
  {
    label: "Name",
    type: "text",
    required: true,
    options: ""
  }
];

let roomSocket = null;
let updateTimer = null;

function renderFields() {
  fieldsContainer.innerHTML = "";

  fieldState.forEach((field, index) => {
    const row = document.createElement("div");
    row.className = "field-row";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Label";
    labelInput.value = field.label;
    labelInput.addEventListener("input", () => {
      fieldState[index].label = labelInput.value;
      queueUpdateEvent("edited field labels");
    });

    const typeSelect = document.createElement("select");
    for (const type of availableFieldTypes) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = type === field.type;
      typeSelect.appendChild(option);
    }
    typeSelect.addEventListener("change", () => {
      fieldState[index].type = typeSelect.value;
      queueUpdateEvent("changed field type");
    });

    const requiredLabel = document.createElement("label");
    requiredLabel.className = "inline";
    const requiredCheckbox = document.createElement("input");
    requiredCheckbox.type = "checkbox";
    requiredCheckbox.checked = field.required;
    requiredCheckbox.addEventListener("change", () => {
      fieldState[index].required = requiredCheckbox.checked;
      queueUpdateEvent("changed field requirement");
    });
    requiredLabel.appendChild(requiredCheckbox);
    requiredLabel.appendChild(document.createTextNode("Required"));

    const optionsInput = document.createElement("input");
    optionsInput.type = "text";
    optionsInput.placeholder = "Select options (comma separated)";
    optionsInput.value = field.options;
    optionsInput.addEventListener("input", () => {
      fieldState[index].options = optionsInput.value;
      queueUpdateEvent("edited select options");
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      fieldState.splice(index, 1);
      renderFields();
      queueUpdateEvent("removed a field");
    });

    row.appendChild(labelInput);
    row.appendChild(typeSelect);
    row.appendChild(requiredLabel);
    row.appendChild(optionsInput);
    row.appendChild(removeButton);

    fieldsContainer.appendChild(row);
  });
}

function parseOptions(csv) {
  return csv
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function connectToRoom(formId) {
  if (!formId) {
    return;
  }

  if (roomSocket) {
    roomSocket.close();
    roomSocket = null;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${window.location.host}/api/realtime/forms/${encodeURIComponent(formId)}`;

  roomSocket = new WebSocket(wsUrl);
  roomStatus.textContent = `Connecting to ${formId}...`;

  roomSocket.addEventListener("open", () => {
    roomStatus.textContent = `Connected: ${formId}`;
  });

  roomSocket.addEventListener("close", () => {
    roomStatus.textContent = "Disconnected";
    presenceCount.textContent = "0";
  });

  roomSocket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "presence") {
      presenceCount.textContent = String(payload.count ?? 0);
      return;
    }

    if (payload.type === "last_update") {
      const actor = payload.actor || "unknown";
      const detail = payload.detail || "updated form";
      lastUpdate.textContent = `${payload.at || "now"} by ${actor} (${detail})`;
    }
  });
}

function sendUpdate(detail) {
  if (!roomSocket || roomSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  roomSocket.send(
    JSON.stringify({
      type: "form_update",
      actor: actorNameInput.value.trim() || "builder",
      detail
    })
  );
}

function queueUpdateEvent(detail) {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }

  updateTimer = setTimeout(() => {
    sendUpdate(detail);
  }, 200);
}

addFieldButton.addEventListener("click", () => {
  fieldState.push({
    label: "",
    type: "text",
    required: false,
    options: ""
  });
  renderFields();
  queueUpdateEvent("added a field");
});

connectRoomButton.addEventListener("click", () => {
  connectToRoom(roomIdInput.value.trim());
});

notifyUpdateButton.addEventListener("click", () => {
  sendUpdate("manual update event");
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  createResult.textContent = "Creating form...";

  const formData = new FormData(createForm);
  const payload = {
    tenantId: String(formData.get("tenantId") || "tenant_default").trim(),
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    fields: fieldState.map((field) => ({
      label: field.label.trim(),
      type: field.type,
      required: Boolean(field.required),
      options: field.type === "select" ? parseOptions(field.options) : []
    }))
  };

  const response = await fetch("/api/forms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    createResult.textContent = result.error || "Failed to create form";
    return;
  }

  const publicLink = `${window.location.origin}/f/${result.id}`;
  const linkHtml = `Created <strong>${result.id}</strong>. Public URL: <a href="${publicLink}" target="_blank" rel="noopener">${publicLink}</a>`;
  createResult.innerHTML = linkHtml;

  roomIdInput.value = result.id;
  connectToRoom(result.id);
  sendUpdate("created form definition");
});

createForm.addEventListener("input", () => {
  queueUpdateEvent("updated form metadata");
});

renderFields();
