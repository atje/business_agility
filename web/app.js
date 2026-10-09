let nextStageId = 1;
let nextTeamId = 1;
const CONFIGURATION_STORAGE_KEY = "process-simulator-configurations";

// Set version number
document.querySelector("#version-number").textContent = "BETA-0.20 (Released 2026-10-09)";

function createStage(name, duration, wipLimit) {
  return { id: `stage-${nextStageId++}`, name, duration, wipLimit };
}

function createTeam(name, stages, reworkProbability = 0.2, reworkDuration = 1) {
  return {
    id: `team-${nextTeamId++}`,
    name,
    stages: stages.map(([stageName, duration, wipLimit]) => createStage(stageName, duration, wipLimit)),
    reworkProbability,
    reworkDuration,
    downstreamTeamIds: [],
  };
}

const teamConfigs = [
  createTeam("Product dev team", [["Analyze", 2, 0],["Design", 4, 0], ["Test", 1, 0]]),
  createTeam("Release team", [["Integrate", 3, 0], ["Stage", 2, 0], ["Release", 1, 0]]),
];
teamConfigs[0].downstreamTeamIds = [teamConfigs[1].id];
let selectedTeamId = teamConfigs[0].id;

function copyTeams(teams) {
  return teams.map((team) => ({
    ...team,
    downstreamTeamIds: [...team.downstreamTeamIds],
    stages: team.stages.map((stage) => ({ ...stage })),
  }));
}

const state = {
  running: false,
  paused: false,
  lastFrame: null,
  nextArrival: 0,
  simulationTime: 0,
  nextWorkItemId: 1,
  workItems: [],
  workItemRecords: [],
  joinBuffers: new Map(),
  terminalTeamIds: [],
  leadTimes: [],
  parameters: null,
  teams: copyTeams(teamConfigs),
};

const elements = {
  form: document.querySelector("#simulation-form"),
  flow: document.querySelector("#process-flow"),
  teamEditor: document.querySelector("#team-editor"),
  addTeam: document.querySelector("#add-team-button"),
  toggleTeamEditor: document.querySelector("#toggle-team-editor-button"),
  status: document.querySelector("#status"),
  pause: document.querySelector("#pause-button"),
  reset: document.querySelector("#reset-button"),
  time: document.querySelector("#simulation-time"),
  chartTime: document.querySelector("#chart-simulation-time"),
  completed: document.querySelector("#completed-count"),
  inProcess: document.querySelector("#in-process-count"),
  average: document.querySelector("#average-lead-time"),
  p95: document.querySelector("#p95-lead-time"),
  timingChart: document.querySelector("#workitem-timing-chart"),
  infoButton: document.querySelector("#simulation-info-button"),
  configurationName: document.querySelector("#configuration-name"),
  savedConfiguration: document.querySelector("#saved-configuration-select"),
  saveConfiguration: document.querySelector("#save-configuration-button"),
  loadConfiguration: document.querySelector("#load-configuration-button"),
  deleteConfiguration: document.querySelector("#delete-configuration-button"),
};

function readParameters() {
  const formData = new FormData(elements.form);
  return {
    workItemCount: Number(formData.get("workItemCount")),
    arrivalInterval: Number(formData.get("arrivalInterval")),
    speed: Number(formData.get("speed")),
    variability: Number(formData.get("variability")),
  };
}

function makeField(labelText, input) {
  const label = document.createElement("label");
  label.append(labelText, input);
  return label;
}

function makeInput(value, type = "text") {
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  return input;
}

function renderTeamEditor() {
  const fragment = document.createDocumentFragment();
  const tabList = document.createElement("div");
  tabList.className = "team-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Team settings");
  for (const team of teamConfigs) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "team-tab";
    tab.id = `team-tab-${team.id}`;
    tab.dataset.action = "select-team";
    tab.dataset.teamId = team.id;
    tab.dataset.teamTabId = team.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `team-panel-${team.id}`);
    tab.setAttribute("aria-selected", String(team.id === selectedTeamId));
    tab.tabIndex = team.id === selectedTeamId ? 0 : -1;
    tab.textContent = team.name || "New team";
    tabList.append(tab);
  }
  fragment.append(tabList);

  for (const team of teamConfigs) {
    const tabPanel = document.createElement("div");
    tabPanel.className = "team-settings-panel";
    tabPanel.id = `team-panel-${team.id}`;
    tabPanel.setAttribute("role", "tabpanel");
    tabPanel.setAttribute("aria-labelledby", `team-tab-${team.id}`);
    tabPanel.tabIndex = 0;
    tabPanel.hidden = team.id !== selectedTeamId;

    const card = document.createElement("article");
    card.className = "team-config";

    const header = document.createElement("div");
    header.className = "team-config-header";
    const title = document.createElement("h3");
    title.textContent = team.name || "New team";
    const removeTeam = document.createElement("button");
    removeTeam.type = "button";
    removeTeam.className = "quiet-button";
    removeTeam.dataset.action = "remove-team";
    removeTeam.dataset.teamId = team.id;
    removeTeam.textContent = "Remove team";
    removeTeam.disabled = teamConfigs.length === 1;
    header.append(title, removeTeam);
    card.append(header);

    const fields = document.createElement("div");
    fields.className = "team-config-fields";
    const nameInput = makeInput(team.name);
    nameInput.required = true;
    nameInput.dataset.teamId = team.id;
    nameInput.dataset.teamField = "name";
    nameInput.setAttribute("title", "Give the team a name to identify it in the process flow");
    fields.append(makeField("Team name", nameInput));

    const probabilityInput = makeInput(team.reworkProbability, "number");
    probabilityInput.min = "0";
    probabilityInput.max = "1";
    probabilityInput.step = "0.01";
    probabilityInput.dataset.teamId = team.id;
    probabilityInput.dataset.teamField = "reworkProbability";
    probabilityInput.setAttribute("title", "Probability of rework for workItems completed by the team, between 0 and 1 where 1 corresponds to 100% of workItems requiring rework");
    fields.append(makeField("Rework probability", probabilityInput));

    const durationInput = makeInput(team.reworkDuration, "number");
    durationInput.min = "0";
    durationInput.step = "0.1";
    durationInput.dataset.teamId = team.id;
    durationInput.dataset.teamField = "reworkDuration";
    durationInput.setAttribute("title", "Duration in case of rework for workItems completed by the team, in days");
    fields.append(makeField("Rework duration (days)", durationInput));

    const downstream = document.createElement("fieldset");
    downstream.className = "connection-options";
    const downstreamLegend = document.createElement("legend");
    downstreamLegend.textContent = "Feeds into";
    downstream.append(downstreamLegend);
    const downstreamList = document.createElement("div");
    downstreamList.className = "connection-options-list";
    for (const optionTeam of teamConfigs) {
      if (optionTeam.id === team.id) continue;
      const choice = document.createElement("label");
      choice.className = "connection-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = team.downstreamTeamIds.includes(optionTeam.id);
      checkbox.dataset.teamId = team.id;
      checkbox.dataset.connectionTargetId = optionTeam.id;
      const choiceName = document.createElement("span");
      choiceName.textContent = optionTeam.name || "New team";
      choice.append(checkbox, choiceName);
      downstreamList.append(choice);
    }
    downstream.append(downstreamList);
    fields.append(downstream);
    card.append(fields);

    const stagesHeader = document.createElement("div");
    stagesHeader.className = "stages-editor-header";
    const stagesTitle = document.createElement("h4");
    stagesTitle.textContent = "Process stages";
    const addStage = document.createElement("button");
    addStage.type = "button";
    addStage.className = "quiet-button";
    addStage.dataset.action = "add-stage";
    addStage.dataset.teamId = team.id;
    addStage.textContent = "Add stage";
    stagesHeader.append(stagesTitle, addStage);
    card.append(stagesHeader);

    const stages = document.createElement("div");
    stages.className = "stage-editor-list";
    for (const stage of team.stages) {
      const row = document.createElement("div");
      row.className = "stage-editor-row";
      const stageName = makeInput(stage.name);
      stageName.required = true;
      stageName.dataset.teamId = team.id;
      stageName.dataset.stageId = stage.id;
      stageName.dataset.stageField = "name";
      const stageDuration = makeInput(stage.duration, "number");
      stageDuration.min = "0.1";
      stageDuration.step = "0.1";
      stageDuration.dataset.teamId = team.id;
      stageDuration.dataset.stageId = stage.id;
      stageDuration.dataset.stageField = "duration";
      stageDuration.setAttribute("title", "Stage duration in days");
      const stageWIPLimit = makeInput(stage.wipLimit, "number");
      stageWIPLimit.min = "0";
      stageWIPLimit.step = "1";
      stageWIPLimit.dataset.teamId = team.id;
      stageWIPLimit.dataset.stageId = stage.id;
      stageWIPLimit.dataset.stageField = "wipLimit";
      stageWIPLimit.setAttribute("title", "Work In Process limit for the stage, 0 = no limit");
      const removeStage = document.createElement("button");
      removeStage.type = "button";
      removeStage.className = "icon-button";
      removeStage.dataset.action = "remove-stage";
      removeStage.dataset.teamId = team.id;
      removeStage.dataset.stageId = stage.id;
      removeStage.textContent = "🗑️";
      removeStage.setAttribute("aria-label", `Remove ${stage.name || "stage"} stage`);
      removeStage.disabled = team.stages.length === 1;
      row.append(makeField("Stage name", stageName), makeField("Duration (days)", stageDuration), makeField("WIP Limit (0 = no limit)", stageWIPLimit), removeStage);
      stages.append(row);
    }
    card.append(stages);
    tabPanel.append(card);
    fragment.append(tabPanel);
  }
  elements.teamEditor.replaceChildren(fragment);
}

function validateTeamSet(teams) {
  for (const team of teams) {
    if (!team.name.trim()) return "Every team needs a name.";
    if (!team.stages.length) return `${team.name} needs at least one process stage.`;
    if (
      !Number.isFinite(team.reworkProbability) ||
      team.reworkProbability < 0 ||
      team.reworkProbability > 1
    ) {
      return `${team.name} rework probability must be between 0 and 1.`;
    }
    if (!Number.isFinite(team.reworkDuration) || team.reworkDuration < 0) {
      return `${team.name} rework duration must be zero or greater.`;
    }
    if (
      !Array.isArray(team.downstreamTeamIds) ||
      team.downstreamTeamIds.some((teamId) =>
       teamId === team.id || !teams.some((candidate) => candidate.id === teamId),
      )
    ) {
      return `${team.name} has an invalid downstream connection.`;
    }
    for (const stage of team.stages) {
      if (!stage.name.trim()) return `${team.name} has a stage without a name.`;
      if (!Number.isFinite(stage.duration) || stage.duration <= 0) {
        return `${team.name}: ${stage.name} duration must be greater than zero.`;
      }
      if (!Number.isInteger(stage.wipLimit) || stage.wipLimit < 0) {
        return `${team.name}: ${stage.name} WIP limit must be zero or greater.`;
      }
    }
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(teamId) {
    if (visiting.has(teamId)) return false;
    if (visited.has(teamId)) return true;
    visiting.add(teamId);
    const team = teams.find((candidate) => candidate.id === teamId);
    if (!team.downstreamTeamIds.every((downstreamTeamId) => visit(downstreamTeamId))) return false;
    visiting.delete(teamId);
    visited.add(teamId);
    return true;
  }

  if (!teams.every((team) => visit(team.id))) {
    return "Team connections cannot contain a cycle.";
  }
  return "";
}

function validateTeams() {
  return validateTeamSet(teamConfigs);
}

function readSavedConfigurations() {
  const serialized = localStorage.getItem(CONFIGURATION_STORAGE_KEY);
  if (serialized === null) return [];
  const configurations = JSON.parse(serialized);
  if (
    !Array.isArray(configurations) ||
    configurations.some((configuration) =>
      !configuration || typeof configuration.name !== "string" || !configuration.config,
    )
  ) {
    throw new Error("Saved configurations have an invalid format.");
  }
  return configurations;
}

function refreshSavedConfigurations(selectedName = "") {
  const configurations = readSavedConfigurations();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a configuration";
  const options = configurations.map((configuration) => {
    const option = document.createElement("option");
    option.value = configuration.name;
    option.textContent = configuration.name;
    return option;
  });
  elements.savedConfiguration.replaceChildren(placeholder, ...options);
  elements.savedConfiguration.value = selectedName;
  elements.loadConfiguration.disabled = !selectedName;
  elements.deleteConfiguration.disabled = !selectedName;
}

function validateSavedConfiguration(configuration) {
  if (
    !configuration ||
    configuration.version !== 1 ||
    !configuration.parameters ||
    !Array.isArray(configuration.teams) ||
    configuration.teams.length === 0
  ) {
    return "The selected configuration has an invalid format.";
  }

  const { workItemCount, arrivalInterval, speed, variability } = configuration.parameters;
  const validSpeeds = [...elements.form.elements.speed.options].map((option) => Number(option.value));
  const validVariabilities = [...elements.form.elements.variability.options].map((option) => Number(option.value));
  if (
    !Number.isInteger(workItemCount) || workItemCount < 1 || workItemCount > 1000 ||
    !Number.isFinite(arrivalInterval) || arrivalInterval < 0.1 ||
    !validSpeeds.includes(speed) || !validVariabilities.includes(variability)
  ) {
    return "The selected configuration has invalid simulation parameters.";
  }

  const teamIds = new Set();
  for (const team of configuration.teams) {
    if (
      !team ||
      typeof team.id !== "string" ||
      teamIds.has(team.id) ||
      typeof team.name !== "string" ||
      !Number.isFinite(team.reworkProbability) ||
      !Number.isFinite(team.reworkDuration) ||
      !Array.isArray(team.downstreamTeamIds) ||
      !team.downstreamTeamIds.every((teamId) => typeof teamId === "string") ||
      !Array.isArray(team.stages) ||
      team.stages.some((stage) =>
        !stage ||
        typeof stage.id !== "string" ||
        typeof stage.name !== "string" ||
        !Number.isFinite(stage.duration) ||
        !Number.isInteger(stage.wipLimit) ||
        stage.wipLimit < 0,
      )
    ) {
      return "The selected configuration has invalid team or stage data.";
    }
    teamIds.add(team.id);
  }

  const restoredTeams = configuration.teams.map((team) => ({
    ...team,
    id: `restore-${team.id}`,
    stages: team.stages.map((stage) => ({ ...stage, id: `restore-${stage.id}` })),
    downstreamTeamIds: team.downstreamTeamIds.map((teamId) => `restore-${teamId}`),
  }));
  return validateTeamSet(restoredTeams);
}

function saveConfiguration() {
  const name = elements.configurationName.value.trim();
  if (!name) {
    setStatus("Enter a name for this configuration.", "status-error");
    elements.configurationName.focus();
    return;
  }
  const configurationError = validateTeams();
  if (configurationError) {
    setStatus(configurationError, "status-error");
    return;
  }
  if (!elements.form.reportValidity()) return;

  try {
    const configurations = readSavedConfigurations();
    const existingIndex = configurations.findIndex((configuration) => configuration.name === name);
    if (existingIndex !== -1 && !window.confirm(`Replace the saved configuration "${name}"?`)) return;
    const entry = {
      name,
      config: {
        version: 1,
        parameters: readParameters(),
        teams: copyTeams(teamConfigs),
      },
    };
    if (existingIndex === -1) configurations.push(entry);
    else configurations[existingIndex] = entry;
    localStorage.setItem(CONFIGURATION_STORAGE_KEY, JSON.stringify(configurations));
    refreshSavedConfigurations(name);
    setStatus(`Configuration "${name}" saved.`);
  } catch (error) {
    setStatus(`Could not save configuration: ${error.message}`, "status-error");
  }
}

function restoreConfiguration() {
  const name = elements.savedConfiguration.value;
  if (!name) return;
  try {
    const entry = readSavedConfigurations().find((configuration) => configuration.name === name);
    if (!entry) {
      setStatus("The selected saved configuration could not be found.", "status-error");
      refreshSavedConfigurations();
      return;
    }
    const configurationError = validateSavedConfiguration(entry.config);
    if (configurationError) {
      setStatus(configurationError, "status-error");
      return;
    }

    const restoredTeams = entry.config.teams.map((team) => ({
      ...team,
      id: `team-${nextTeamId++}`,
      stages: team.stages.map((stage) => ({
        ...stage,
        id: `stage-${nextStageId++}`,
      })),
    }));
    const idMap = new Map(entry.config.teams.map((team, index) => [team.id, restoredTeams[index].id]));
    for (let index = 0; index < restoredTeams.length; index += 1) {
      restoredTeams[index].downstreamTeamIds = entry.config.teams[index].downstreamTeamIds
        .map((teamId) => idMap.get(teamId));
    }

    teamConfigs.splice(0, teamConfigs.length, ...restoredTeams);
    selectedTeamId = teamConfigs[0].id;
    elements.form.elements.workItemCount.value = entry.config.parameters.workItemCount;
    elements.form.elements.arrivalInterval.value = entry.config.parameters.arrivalInterval;
    elements.form.elements.speed.value = entry.config.parameters.speed;
    elements.form.elements.variability.value = entry.config.parameters.variability;
    elements.configurationName.value = name;
    resetSimulation();
    renderTeamEditor();
    refreshTeamPreview();
    setStatus(`Configuration "${name}" restored.`);
  } catch (error) {
    setStatus(`Could not restore configuration: ${error.message}`, "status-error");
  }
}

function deleteConfiguration() {
  const name = elements.savedConfiguration.value;
  if (!name || !window.confirm(`Delete the saved configuration "${name}"?`)) return;
  try {
    const configurations = readSavedConfigurations().filter((configuration) => configuration.name !== name);
    localStorage.setItem(CONFIGURATION_STORAGE_KEY, JSON.stringify(configurations));
    refreshSavedConfigurations();
    setStatus(`Configuration "${name}" deleted.`);
  } catch (error) {
    setStatus(`Could not delete configuration: ${error.message}`, "status-error");
  }
}

function setStatus(message, statusClass = "status-idle") {
  elements.status.textContent = message;
  elements.status.className = `status ${statusClass}`;
}

function resetSimulation() {
  state.running = false;
  state.paused = false;
  state.lastFrame = null;
  state.nextArrival = 0;
  state.simulationTime = 0;
  state.nextWorkItemId = 1;
  state.workItems = [];
  state.workItemRecords = [];
  state.joinBuffers = new Map();
  state.terminalTeamIds = [];
  state.leadTimes = [];
  state.teams = copyTeams(teamConfigs);
  elements.pause.disabled = true;
  elements.pause.textContent = "Pause";
  setTeamEditorDisabled(false);
  setStatus("Ready");
  render();
}

function setTeamEditorDisabled(disabled) {
  elements.teamEditor.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = disabled || control.dataset.action === "remove-team" && teamConfigs.length === 1 ||
      control.dataset.action === "remove-stage" && teamConfigs.find((team) => team.id === control.dataset.teamId)?.stages.length === 1;
  });
  elements.addTeam.disabled = disabled;
  elements.configurationName.disabled = disabled;
  elements.savedConfiguration.disabled = disabled;
  elements.saveConfiguration.disabled = disabled;
  elements.loadConfiguration.disabled = disabled || !elements.savedConfiguration.value;
  elements.deleteConfiguration.disabled = disabled || !elements.savedConfiguration.value;
}

function startSimulation(event) {
  event.preventDefault();
  resetSimulation();
  const configurationError = validateTeams();
  if (configurationError) {
    setStatus(configurationError, "status-error");
    return;
  }
  state.parameters = readParameters();
  state.teams = copyTeams(teamConfigs);
  state.terminalTeamIds = state.teams
    .filter((team) => team.downstreamTeamIds.length === 0)
    .map((team) => team.id);
  state.running = true;
  setTeamEditorDisabled(true);
  elements.pause.disabled = false;
  setStatus("Running", "status-running");
  requestAnimationFrame(tick);
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  elements.pause.textContent = state.paused ? "Resume" : "Pause";
  setStatus(state.paused ? "Paused" : "Running", state.paused ? "status-paused" : "status-running");
  if (!state.paused) {
    state.lastFrame = null;
    requestAnimationFrame(tick);
  }
}

function tick(timestamp) {
  if (!state.running || state.paused) return;
  const elapsedSeconds = state.lastFrame === null ? 0 : (timestamp - state.lastFrame) / 1000;
  state.lastFrame = timestamp;
  const elapsedDays = elapsedSeconds * state.parameters.speed;
  advanceSimulation(elapsedDays);
  render();

  if (state.leadTimes.length >= state.parameters.workItemCount) {
    state.running = false;
    elements.pause.disabled = true;
    setTeamEditorDisabled(false);
    setStatus("Complete", "status-complete");
    return;
  }
  requestAnimationFrame(tick);
}

function advanceSimulation(days) {
  const previousTime = state.simulationTime;
  state.simulationTime += days;

  while (
    state.nextWorkItemId <= state.parameters.workItemCount &&
    state.simulationTime >= state.nextArrival
  ) {
    const roots = state.teams.filter(
      (team) => !state.teams.some((candidate) => candidate.downstreamTeamIds.includes(team.id)),
    );
    const record = {
      id: state.nextWorkItemId++,
      startTime: state.nextArrival,
      processingTime: 0,
      leadTime: null,
      terminalOutputs: new Set(),
      completed: false,
    };
    state.workItemRecords.push(record);
    for (const sourceTeam of roots) {
      state.workItems.push(createWorkItem(record, sourceTeam.id, state.nextArrival));
    }
    state.nextArrival += state.parameters.arrivalInterval;
  }

  for (const team of state.teams) {
    advanceTeamWorkItems(team, previousTime);
  }
}

// Advance workItems for a specific team, considering WIP limits and rework. 
// This function iterates through each stage of the team and processes the active workItems accordingly.
// If a stage has a WIP limit, it will only process workItems up to that limit. 
// If a workItem is ready for rework, it will be processed accordingly.
function advanceTeamWorkItems(team, previousTime) {
  for (const stage of team.stages) {
    // Find all active workItems for this team and stage that are not completed, transferred, or queued.
    const activeWorkItems = state.workItems.filter(
      (workItem) => workItem.teamId === team.id && workItem.stageIndex === team.stages.indexOf(stage) && !workItem.completed && !workItem.transferred && !workItem.queued
    );

    // Add queued workItems to the active workItems list if they are ready to be processed and WIP limits allow it.
    if (activeWorkItems.length <= stage.wipLimit || stage.wipLimit === 0) {
      const queuedWorkItems = state.workItems.filter(
        (workItem) => workItem.teamId === team.id && workItem.stageIndex === team.stages.indexOf(stage) && !workItem.completed && !workItem.transferred && workItem.queued
      );
      const availableSlots = stage.wipLimit === 0 ? queuedWorkItems.length : Math.max(0, stage.wipLimit - activeWorkItems.length);
      activeWorkItems.push(...queuedWorkItems.slice(0, availableSlots));
    }

    // Advance each active workItem for the current stage, considering the time elapsed and any rework that may be required.
    for (const workItem of activeWorkItems) {
      const activeFrom = Math.max(previousTime, workItem.readyAt);
      const activeDays = Math.max(0, state.simulationTime - activeFrom);
      workItem.queued = false; // Mark the workItem as no longer queued since it's now active.
      advanceWorkItem(workItem, activeDays, state.simulationTime);
    }
  }
}

// Calulate the WorkItem work time for a specific team and stage index, taking into account the variation set in the simulation
function calcStageWorkTime(team, stageIndex) {
  let workTime = team.stages[stageIndex].duration * (1 + (Math.random() * 2 - 1) * state.parameters.variability);
  //console.log("calcStageWorkTime ", "team name: ", team.name, ",stage ",team.stages[stageIndex].name, ",stage duration: ", team.stages[stageIndex].duration, ",variation: ",state.parameters.variability, "workTime: ",workTime);
  return Math.abs(workTime);
}

function createWorkItem(record, teamId, readyAt) {
  return {
    id: record.id,
    record,
    teamId,
    stageIndex: 0,
    stageElapsed: 0,
    readyAt,
    workTimeRemaining: calcStageWorkTime(state.teams.find((team) => team.id === teamId), 0),
    reworkRemaining: 0,
    queued: true,
    completed: false,
    transferred: false,
  };
}

function advanceWorkItem(workItem, days, endTime) {
  let remainingDays = days;
  let eventTime = endTime - days;
  while (remainingDays > 0.000001 && !workItem.completed && !workItem.transferred) {
    //console.log("advanceWorkItem ", "workItem id: ", workItem.id, ",remainingDays: ", remainingDays, ",workItem.workTimeRemaining: ", workItem.workTimeRemaining, ",workItem.reworkRemaining: ", workItem.reworkRemaining, ",workItem.stageIndex: ", workItem.stageIndex);
    const team = state.teams.find((candidate) => candidate.id === workItem.teamId);
    if (workItem.reworkRemaining > 0) {
      const worked = Math.min(remainingDays, workItem.reworkRemaining);
      workItem.record.processingTime += worked;
      workItem.reworkRemaining -= worked;
      remainingDays -= worked;
      eventTime += worked;
      if (workItem.reworkRemaining <= 0.000001) {
        workItem.reworkRemaining = 0;
        finishTeam(workItem, team, eventTime);
      }
      continue;
    }

    const worked = Math.min(remainingDays, workItem.workTimeRemaining);

    workItem.record.processingTime += worked;
    workItem.workTimeRemaining -= worked;
    remainingDays -= worked;
    eventTime += worked;

    if (workItem.workTimeRemaining > 0) continue;

    if (workItem.stageIndex < team.stages.length - 1) {
      workItem.stageIndex += 1;
      workItem.workTimeRemaining = calcStageWorkTime(team, workItem.stageIndex);
      workItem.readyAt = eventTime;
      workItem.queued = true;
    } else if (team.reworkProbability > 0 && Math.random() < team.reworkProbability) {
      workItem.reworkRemaining = team.reworkDuration;
      if (workItem.reworkRemaining === 0) finishTeam(workItem, team, eventTime);
    } else {
      finishTeam(workItem, team, eventTime);
    }
  }
}

// Mark a workItem as completed for a team, and handle downstream teams if applicable.
function finishTeam(workItem, team, completedAt) {
  workItem.transferred = true;
  if (team.downstreamTeamIds.length) {
    workItem.queued = true;
    for (const downstreamTeamId of team.downstreamTeamIds) {
      const upstreamTeams = state.teams.filter((candidate) =>
        candidate.downstreamTeamIds.includes(downstreamTeamId),
      );

      // If there is only one upstream team, we can immediately create a work item for the downstream team.
      if (upstreamTeams.length === 1) {
        state.workItems.push(createWorkItem(workItem.record, downstreamTeamId, completedAt));
        continue;
      }

      // If there are multiple upstream teams, we need to buffer the workItem until all upstream teams have completed it.
      const bufferKey = `${workItem.id}:${downstreamTeamId}`;
      let buffer = state.joinBuffers.get(bufferKey);
      if (!buffer) {
        buffer = { teamId: downstreamTeamId, record: workItem.record, arrivals: new Map() };
        state.joinBuffers.set(bufferKey, buffer);
      }

      // If all upstream teams have completed the workItem, we can create a work item for the downstream team.
      buffer.arrivals.set(team.id, completedAt);
      if (buffer.arrivals.size === upstreamTeams.length) {
        state.joinBuffers.delete(bufferKey);
        const readyAt = Math.max(...buffer.arrivals.values());
        state.workItems.push(createWorkItem(workItem.record, downstreamTeamId, readyAt));
      }
    }
    return;
  }

  workItem.completed = true;
  workItem.record.terminalOutputs.add(team.id);
  if (
    !workItem.record.completed &&
    state.terminalTeamIds.every((terminalTeamId) => workItem.record.terminalOutputs.has(terminalTeamId))
  ) {
    workItem.record.completed = true;
    workItem.record.leadTime = completedAt - workItem.record.startTime;
    state.leadTimes.push(workItem.record.leadTime);
  }
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function render() {
  elements.time.textContent = state.simulationTime.toFixed(1);
  elements.chartTime.textContent = state.simulationTime.toFixed(1);
  elements.completed.textContent = state.leadTimes.length;
  elements.inProcess.textContent = state.workItemRecords.filter((workItem) => !workItem.completed).length;
  const average = state.leadTimes.length
    ? state.leadTimes.reduce((sum, value) => sum + value, 0) / state.leadTimes.length
    : null;
  elements.average.textContent = average === null ? "—" : `${average.toFixed(1)} d`;
  const p95 = percentile(state.leadTimes, 0.95);
  elements.p95.textContent = p95 === null ? "—" : `${p95.toFixed(1)} d`;
  renderTimingChart();

  const layout = calculateTeamLayout(state.teams);
  const canvas = document.createElement("div");
  canvas.className = "team-flow-canvas";
  const links = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  links.classList.add("team-flow-links");
  links.setAttribute("aria-hidden", "true");
  links.setAttribute("focusable", "false");
  const nodes = document.createElement("div");
  nodes.className = "team-flow-nodes";
  nodes.style.gridTemplateColumns = `repeat(${layout.columnCount}, minmax(280px, 320px))`;
  const teamNodes = new Map();

  for (const team of state.teams) {
    const panel = renderTeamFlow(team);
    const position = layout.positions.get(team.id);
    panel.dataset.teamNodeId = team.id;
    panel.style.gridColumn = String(position.column + 1);
    panel.style.gridRow = String(position.row + 1);
    teamNodes.set(team.id, panel);
    nodes.append(panel);
  }

  canvas.append(links, nodes);
  elements.flow.replaceChildren(canvas);
  drawTeamConnections(canvas, links, teamNodes);
}

function renderTimingChart() {
  const svg = elements.timingChart;
  const width = 760;
  const height = 420;
  const margin = { top: 22, right: 26, bottom: 64, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const pointGroups = new Map();
  for (const workItem of state.workItemRecords) {
    const leadTime = workItem.completed
      ? workItem.leadTime
      : Math.max(0, state.simulationTime - workItem.startTime);
    const processingRatio = leadTime > 0 ? workItem.processingTime / leadTime : 0;
    const bucketLeadTime = Number(leadTime.toFixed(2));
    const bucketRatio = Number(processingRatio.toFixed(2));
    const key = `${bucketLeadTime}:${bucketRatio}`;
    let group = pointGroups.get(key);
    if (!group) {
      group = {
        leadTime: bucketLeadTime,
        processingRatio: bucketRatio,
        workItemIds: [],
        completedCount: 0,
      };
      pointGroups.set(key, group);
    }
    group.workItemIds.push(workItem.id);
    if (workItem.completed) group.completedCount += 1;
  }
  const points = [...pointGroups.values()];
  const maxLeadTime = Math.max(1, ...points.map((point) => point.leadTime)) * 1.1;
  const maxProcessingRatio = Math.max(1, ...points.map((point) => point.processingRatio)) * 1.1;
  svg.replaceChildren();
  svg.setAttribute(
    "aria-label",
    `${state.workItemRecords.length} work items in ${points.length} plotted groups. Lead time in days is on the horizontal axis; processing time divided by lead time is on the vertical axis. Bubble size represents the number of workItems in each group.`,
  );

  const makeSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [attribute, value] of Object.entries(attributes)) {
      element.setAttribute(attribute, String(value));
    }
    return element;
  };

  for (let tick = 0; tick <= 4; tick += 1) {
    const fraction = tick / 4;
    const x = margin.left + plotWidth * fraction;
    const y = margin.top + plotHeight * (1 - fraction);
    svg.append(
      makeSvgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: y,
        y2: y,
        class: "chart-gridline",
      }),
      makeSvgElement("line", {
        x1: x,
        x2: x,
        y1: margin.top,
        y2: height - margin.bottom,
        class: "chart-gridline",
      }),
    );

    const xTick = makeSvgElement("text", {
      x,
      y: height - margin.bottom + 22,
      class: "chart-tick",
      "text-anchor": "middle",
    });
    xTick.textContent = (maxLeadTime * fraction).toFixed(1);
    svg.append(xTick);

    const yTick = makeSvgElement("text", {
      x: margin.left - 12,
      y: y + 4,
      class: "chart-tick",
      "text-anchor": "end",
    });
    yTick.textContent = (maxProcessingRatio * fraction).toFixed(2);
    svg.append(yTick);
  }

  svg.append(
    makeSvgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: height - margin.bottom,
      y2: height - margin.bottom,
      class: "chart-axis",
    }),
    makeSvgElement("line", {
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: height - margin.bottom,
      class: "chart-axis",
    }),
  );

  const xLabel = makeSvgElement("text", {
    x: margin.left + plotWidth / 2,
    y: height - 12,
    class: "chart-axis-label",
    "text-anchor": "middle",
  });
  xLabel.textContent = "Lead time (days)";
  svg.append(xLabel);

  const yLabel = makeSvgElement("text", {
    x: 18,
    y: margin.top + plotHeight / 2,
    class: "chart-axis-label",
    "text-anchor": "middle",
    transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`,
  });
  yLabel.textContent = "Processing time / lead time";
  svg.append(yLabel);

  for (const group of points) {
    const workItemCount = group.workItemIds.length;
    const completedCount = group.completedCount;
    const statusClass = completedCount === workItemCount
      ? "chart-point-complete"
      : completedCount === 0
        ? "chart-point-active"
        : "chart-point-mixed";
    const radius = 5 + Math.sqrt(workItemCount) * 4;
    const pointLabel = `${workItemCount} workItem${workItemCount === 1 ? "" : "s"}: ${group.leadTime.toFixed(2)} lead days, processing-to-lead ratio ${group.processingRatio.toFixed(2)}, ${completedCount} completed`;
    const point = makeSvgElement("circle", {
      cx: margin.left + (group.leadTime / maxLeadTime) * plotWidth,
      cy: margin.top + plotHeight - (group.processingRatio / maxProcessingRatio) * plotHeight,
      r: radius,
      class: `chart-point ${statusClass}`,
      tabindex: 0,
      "aria-label": pointLabel,
    });
    const title = makeSvgElement("title");
    title.textContent = pointLabel;
    point.append(title);
    svg.append(point);

    if (workItemCount > 1) {
      const countLabel = makeSvgElement("text", {
        x: margin.left + (group.leadTime / maxLeadTime) * plotWidth,
        y: margin.top + plotHeight - (group.processingRatio / maxProcessingRatio) * plotHeight + 4,
        class: "chart-point-count",
        "text-anchor": "middle",
      });
      countLabel.textContent = String(workItemCount);
      countLabel.setAttribute("pointer-events", "none");
      svg.append(countLabel);
    }
  }

  if (!points.length) {
    const empty = makeSvgElement("text", {
      x: margin.left + plotWidth / 2,
      y: margin.top + plotHeight / 2,
      class: "chart-empty-state",
      "text-anchor": "middle",
    });
    empty.textContent = "No workItems yet";
    svg.append(empty);
  }
}

function calculateTeamLayout(teams) {
  const incomingCounts = new Map(teams.map((team) => [team.id, 0]));
  const columns = new Map(teams.map((team) => [team.id, 0]));
  for (const team of teams) {
    for (const downstreamTeamId of team.downstreamTeamIds) {
      incomingCounts.set(downstreamTeamId, (incomingCounts.get(downstreamTeamId) ?? 0) + 1);
    }
  }

  const queue = teams.filter((team) => incomingCounts.get(team.id) === 0).map((team) => team.id);
  const visited = new Set();
  while (queue.length) {
    const teamId = queue.shift();
    visited.add(teamId);
    const team = teams.find((candidate) => candidate.id === teamId);
    for (const downstreamTeamId of team.downstreamTeamIds) {
      columns.set(
        downstreamTeamId,
        Math.max(columns.get(downstreamTeamId) ?? 0, (columns.get(teamId) ?? 0) + 1),
      );
      incomingCounts.set(downstreamTeamId, incomingCounts.get(downstreamTeamId) - 1);
      if (incomingCounts.get(downstreamTeamId) === 0) queue.push(downstreamTeamId);
    }
  }

  const furthestColumn = Math.max(0, ...columns.values());
  for (const team of teams) {
    if (!visited.has(team.id)) columns.set(team.id, furthestColumn + 1);
  }

  const rowsByColumn = new Map();
  const positions = new Map();
  for (const team of teams) {
    const column = columns.get(team.id) ?? 0;
    const row = rowsByColumn.get(column) ?? 0;
    positions.set(team.id, { column, row });
    rowsByColumn.set(column, row + 1);
  }
  return {
    positions,
    columnCount: Math.max(1, ...[...columns.values()].map((column) => column + 1)),
  };
}

function drawTeamConnections(canvas, svg, teamNodes) {
  const canvasBounds = canvas.getBoundingClientRect();
  const width = canvas.scrollWidth;
  const height = canvas.scrollHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const definitions = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "team-flow-arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrow.setAttribute("fill", "#78909c");
  marker.append(arrow);
  definitions.append(marker);
  svg.append(definitions);

  for (const team of state.teams) {
    const source = teamNodes.get(team.id);
    if (!source) continue;
    const sourceBounds = source.getBoundingClientRect();
    const startX = sourceBounds.right - canvasBounds.left;
    const startY = sourceBounds.top + sourceBounds.height / 2 - canvasBounds.top;
    for (const downstreamTeamId of team.downstreamTeamIds) {
      const target = teamNodes.get(downstreamTeamId);
      if (!target) continue;
      const targetBounds = target.getBoundingClientRect();
      const endX = targetBounds.left - canvasBounds.left;
      const endY = targetBounds.top + targetBounds.height / 2 - canvasBounds.top;
      const bend = Math.max(32, (endX - startX) * 0.45);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("team-flow-connection");
      path.setAttribute("d", `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`);
      path.setAttribute("marker-end", "url(#team-flow-arrow)");
      svg.append(path);
    }
  }
}

// Render a list of workItems for a given stage, showing active and queued workItems with their respective work times and rework times.
// If there are more than 'limit workItems, it will display a message indicating how many more workItems are present.
function renderWorkItemList(list, workItems, classname = "workitem", limit = 10) {
    let actInd = 0;
    for (const workItem of workItems ?? []) {
     const chip = document.createElement("span");
     chip.className = classname;
     chip.textContent = `W${workItem.id}${workItem.reworkRemaining ? " Rework "+workItem.reworkRemaining.toFixed(1) : (workItem.workTimeRemaining && !workItem.queued ? " "+workItem.workTimeRemaining.toFixed(1) : "")}`;
     list.append(chip);
     actInd++;
     if (actInd > limit) {
       const more = document.createElement("span");
       more.textContent = `... ${workItems.length - limit} more`;
       list.append(more);
       break;
     }
   }
}


function renderTeamFlow(team) {
  const panel = document.createElement("article");
  panel.className = "team-flow-panel";
  const heading = document.createElement("div");
  heading.className = "team-flow-header";
  const title = document.createElement("h3");
  title.textContent = team.name;
  const downstream = document.createElement("span");
  downstream.className = "handoff-label";
  downstream.textContent = team.downstreamTeamIds.length
    ? `Feeds ${team.downstreamTeamIds.map((teamId) => state.teams.find((candidate) => candidate.id === teamId)?.name ?? "team").join(", ")}`
    : "Final output";
  heading.append(title, downstream);
  panel.append(heading);

  const stages = document.createElement("div");
  stages.className = "team-flow-stages";

  const upstreamTeams = state.teams.filter((candidate) => candidate.downstreamTeamIds.includes(team.id));
  if (upstreamTeams.length > 1) {
    const waiting = [...state.joinBuffers.entries()].filter(([, buffer]) => buffer.teamId === team.id);
    const joinStage = document.createElement("section");
    joinStage.className = "flow-stage join-stage";
    const joinHeader = document.createElement("div");
    joinHeader.className = "flow-stage-header";
    const joinTitle = document.createElement("h4");
    joinTitle.textContent = "Waiting to join";
    const joinCount = document.createElement("span");
    joinCount.textContent = String(waiting.length);
    joinHeader.append(joinTitle, joinCount);
    const list = document.createElement("div");
    list.className = "workitem-list";
    for (const [bufferKey, buffer] of waiting) {
      const chip = document.createElement("span");
      chip.className = "workitem waiting-workitem";
      chip.textContent = `F${buffer.record.id} ${buffer.arrivals.size}/${upstreamTeams.length}`;
      chip.title = `Waiting for ${upstreamTeams.length - buffer.arrivals.size} upstream team(s)`;
      chip.dataset.bufferKey = bufferKey;
      list.append(chip);
    }
    joinStage.append(joinHeader, list);
    stages.append(joinStage);
  }

  team.stages.forEach((stage, index) => {
    const stageElement = document.createElement("section");
    stageElement.className = "flow-stage";
    const stageHeader = document.createElement("div");
    stageHeader.className = "flow-stage-header";
    const stageName = document.createElement("h4");
    stageName.textContent = stage.name;
    const stageWorkItems = state.workItems.filter(
      (workItem) => !workItem.completed && !workItem.transferred && workItem.teamId === team.id && workItem.stageIndex === index,
    );
    const count = document.createElement("span");
    count.textContent = String(stageWorkItems.length);
       stageHeader.append(stageName, count);
   if (stage.wipLimit > 0) {
      const stageWIPLimit = document.createElement("span");
      stageWIPLimit.textContent = "[" + String(stage.wipLimit) + "]";
      stageHeader.append(stageWIPLimit);
    }
    const list = document.createElement("div");
    list.className = "workitem-list";

    const stageWorkItemsGrouped = Object.groupBy(stageWorkItems, (workItem) => workItem.queued == true ? "queued" : "active");

    renderWorkItemList(list, stageWorkItemsGrouped.active);

    // Add a horizontal divider if the stage has a WIP limit
    if (stage.wipLimit > 0) {
      const queuedHeader = document.createElement("hr");
      queuedHeader.className = "horizontal-divider";
      list.append(queuedHeader);
    }

    renderWorkItemList(list, stageWorkItemsGrouped.queued, "queued-workitem");
    
    stageElement.append(stageHeader, list);
    stages.append(stageElement);
  });

  if (!team.downstreamTeamIds.length) {
    const completed = state.workItemRecords.filter((workItem) => workItem.terminalOutputs.has(team.id));
    const doneStage = document.createElement("section");
    doneStage.className = "flow-stage done-stage";
    const doneHeader = document.createElement("div");
    doneHeader.className = "flow-stage-header";
    const doneTitle = document.createElement("h4");
    doneTitle.textContent = "Completed";
    const doneCount = document.createElement("span");
    doneCount.textContent = String(completed.length);
    doneHeader.append(doneTitle, doneCount);
    const list = document.createElement("div");
    list.className = "workitem-list";

    renderWorkItemList(list, completed.reverse(), "workitem completed-workitem");

    doneStage.append(doneHeader, list);
    stages.append(doneStage);
  }
  panel.append(stages);
  return panel;
}

elements.teamEditor.addEventListener("input", (event) => {
  const target = event.target;
  const team = teamConfigs.find((candidate) => candidate.id === target.dataset.teamId);
  if (!team) return;
  if (target.dataset.teamField) {
    const field = target.dataset.teamField;
    team[field] = field === "name" ? target.value : Number(target.value);
    if (field === "name") {
      target.closest(".team-config").querySelector(".team-config-header h3").textContent = team.name || "New team";
      const tab = elements.teamEditor.querySelector(`[data-team-tab-id="${team.id}"]`);
      if (tab) tab.textContent = team.name || "New team";
    }
    refreshTeamPreview();
    return;
  }
  const stage = team.stages.find((candidate) => candidate.id === target.dataset.stageId);
  if (stage) {
    const field = target.dataset.stageField;
    stage[field] = field === "name" ? target.value : Number(target.value);
    refreshTeamPreview();
  }
});

elements.teamEditor.addEventListener("change", (event) => {
  const target = event.target;
  const team = teamConfigs.find((candidate) => candidate.id === target.dataset.teamId);
  if (!team) return;
  if (target.dataset.connectionTargetId) {
    if (target.checked && !team.downstreamTeamIds.includes(target.dataset.connectionTargetId)) {
      team.downstreamTeamIds.push(target.dataset.connectionTargetId);
    } else if (!target.checked) {
      team.downstreamTeamIds = team.downstreamTeamIds.filter(
        (teamId) => teamId !== target.dataset.connectionTargetId,
      );
    }
  } else if (target.dataset.teamField === "name") {
    elements.teamEditor.querySelectorAll(`[data-connection-target-id="${team.id}"]`).forEach((checkbox) => {
      checkbox.parentElement.querySelector("span").textContent = team.name || "New team";
    });
  }
  refreshTeamPreview();
});

elements.teamEditor.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const team = teamConfigs.find((candidate) => candidate.id === button.dataset.teamId);
  if (!team) return;
  if (button.dataset.action === "select-team") {
    selectedTeamId = team.id;
    renderTeamEditor();
    elements.teamEditor.querySelector(`[data-team-tab-id="${team.id}"]`)?.focus();
    return;
  }
  if (button.dataset.action === "add-stage") {
    team.stages.push(createStage("New stage", 1, 0));
  } else if (button.dataset.action === "remove-stage") {
    team.stages = team.stages.filter((stage) => stage.id !== button.dataset.stageId);
  } else if (button.dataset.action === "remove-team") {
    const teamIndex = teamConfigs.indexOf(team);
    teamConfigs.splice(teamIndex, 1);
    if (selectedTeamId === team.id) {
      selectedTeamId = teamConfigs[Math.max(0, teamIndex - 1)].id;
    }
    for (const candidate of teamConfigs) {
      candidate.downstreamTeamIds = candidate.downstreamTeamIds.filter((teamId) => teamId !== team.id);
    }
  }
  renderTeamEditor();
  refreshTeamPreview();
});

elements.addTeam.addEventListener("click", () => {
  const team = createTeam(`Team ${teamConfigs.length + 1}`, [["New", 2, 0], ["Analysis", 3, 0], ["Development", 5, 0], ["Test", 3, 0]]);
  teamConfigs.push(team);
  selectedTeamId = team.id;
  renderTeamEditor();
  refreshTeamPreview();
});

elements.toggleTeamEditor.addEventListener("click", () => {
  if (elements.teamEditor.style.display == "none") {
    elements.teamEditor.style.display = "inline";
    elements.addTeam.style.display = "inline";
    document.getElementById("toggle-team-editor-button").innerText = "Hide Editor";
  } else {
    elements.teamEditor.style.display = "none";
     elements.addTeam.style.display = "none";
   document.getElementById("toggle-team-editor-button").innerText = "Show Editor";

  }
});

elements.infoButton.addEventListener("click", () => {
    var content = document.getElementById("simulation-info-content");
    if (content.style.maxHeight){
      content.style.maxHeight = null;
      elements.infoButton.style.borderRadius = "5px";
    } else {
      elements.infoButton.style.borderRadius = "5px 5px 0px 0px";
      content.style.maxHeight = content.scrollHeight + "px";
    } 
  });

elements.teamEditor.addEventListener("keydown", (event) => {
  const currentTab = event.target.closest('[role="tab"]');
  if (!currentTab) return;
  const tabs = [...elements.teamEditor.querySelectorAll('[role="tab"]')];
  const currentIndex = tabs.indexOf(currentTab);
  let nextIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  selectedTeamId = tabs[nextIndex].dataset.teamId;
  renderTeamEditor();
  elements.teamEditor.querySelector(`[data-team-tab-id="${selectedTeamId}"]`)?.focus();
});
elements.form.addEventListener("submit", startSimulation);
elements.pause.addEventListener("click", togglePause);
elements.reset.addEventListener("click", resetSimulation);
elements.saveConfiguration.addEventListener("click", saveConfiguration);
elements.loadConfiguration.addEventListener("click", restoreConfiguration);
elements.deleteConfiguration.addEventListener("click", deleteConfiguration);
elements.savedConfiguration.addEventListener("change", () => {
  elements.configurationName.value = elements.savedConfiguration.value;
  elements.loadConfiguration.disabled = !elements.savedConfiguration.value;
  elements.deleteConfiguration.disabled = !elements.savedConfiguration.value;
});
renderTeamEditor();
resetSimulation();
try {
  refreshSavedConfigurations();
} catch (error) {
  setStatus(`Could not read saved configurations: ${error.message}`, "status-error");
}

function refreshTeamPreview() {
  state.teams = copyTeams(teamConfigs);
  render();
}
