"use strict";

const $ = (selector) => document.querySelector(selector);
const native = window.WorkoutAndroid;
const storageKey = "ritm.workouts.v1";
const monthName = new Intl.DateTimeFormat("ru-RU", { month: "long" });
const dayName = new Intl.DateTimeFormat("ru-RU", { month: "long", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const numbers = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const editor = $("#editor");
const editorForm = $("#editor-form");
const confirmation = $("#confirmation");
const stats = $("#exercise-stats");
const muscleGroups = $("#muscle-groups");
const exportForm = $("#export-form");
const screens = ["journal", "catalog", "export"];
let selected = dateKey(new Date());
let visibleMonth = monthStart(parseDate(selected));
let screen = "journal";
let editContext;
let toastTimeout;
let state = { exercises: [], entries: [], muscleGroups: [] };
let canSave = true;

try {
  const saved = native ? native.readJournal() : localStorage.getItem(storageKey);
  if (saved) {
    const stored = JSON.parse(saved);
    if (!Array.isArray(stored.exercises) || !Array.isArray(stored.entries)) throw new Error();
    state = { ...state, ...stored };
  }
} catch {
  canSave = false;
  showToast("Не удалось прочитать журнал");
}

function dateKey(date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function parseDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  return date;
}

function monthStart(date) {
  const start = new Date(date);
  start.setDate(1);
  return start;
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (number) => number.toString(36)).join("-");
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function plural(count, [one, few, many]) {
  const last = count % 10;
  const ending = count % 100;
  if (ending >= 11 && ending <= 14) return many;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
}

function countLabel(count) {
  return count + " " + plural(count, ["запись", "записи", "записей"]);
}

function save(nextState) {
  try {
    if (!canSave) return false;
    const value = JSON.stringify(nextState);
    if (native) {
      if (!native.saveJournal(value)) return false;
    } else {
      localStorage.setItem(storageKey, value);
    }
    state = nextState;
    return true;
  } catch {
    return false;
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 3200);
}

function showScreen(next) {
  const changed = screen !== next;
  screen = next;
  for (const name of screens) {
    $("#" + name).hidden = name !== next;
    const button = $('[data-screen="' + name + '"]');
    if (name === next) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("#today").hidden = next !== "journal";
  if (next === "journal") renderJournal();
  if (next === "catalog") renderCatalog();
  if (next === "export") updateExport();
  if (changed) window.scrollTo(0, 0);
}

function renderCalendar() {
  const days = $("#calendar-days");
  const focusedDate = document.activeElement?.dataset.date;
  const today = dateKey(new Date());
  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const end = new Date(visibleMonth);
  end.setMonth(end.getMonth() + 1, 0);
  const marked = new Set(state.entries.map((entry) => entry.date));
  const fragment = document.createDocumentFragment();
  $("#month-title").textContent = capitalize(monthName.format(visibleMonth)) + " " + visibleMonth.getFullYear();

  for (let i = 0; i < firstWeekday; i++) fragment.append(document.createElement("span"));
  for (let number = 1; number <= end.getDate(); number++) {
    const date = new Date(visibleMonth);
    date.setDate(number);
    const key = dateKey(date);
    const hasWorkout = marked.has(key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = hasWorkout ? "calendar-day has-workout" : "calendar-day";
    button.textContent = number;
    button.dataset.date = key;
    button.setAttribute("aria-label", fullDate.format(date) + (hasWorkout ? ", есть тренировка" : ""));
    button.setAttribute("aria-pressed", String(key === selected));
    if (key === today) button.setAttribute("aria-current", "date");
    fragment.append(button);
  }
  days.replaceChildren(fragment);
  if (focusedDate) days.querySelector('[data-date="' + focusedDate + '"]')?.focus({ preventScroll: true });
}

function exerciseName(id) {
  return state.exercises.find((exercise) => exercise.id === id)?.name ?? "Упражнение";
}

function byName(a, b) {
  return a.name.localeCompare(b.name, "ru");
}

function row(title, detail, onOpen) {
  const element = document.createElement(onOpen ? "button" : "div");
  element.className = "card " + (onOpen ? "entry" : "empty-state");
  element.innerHTML = '<span class="entry-mark"><i class="icon dumbbell" aria-hidden="true"></i></span><span class="entry-text"><strong></strong><small></small></span>';
  element.querySelector("strong").textContent = title;
  element.querySelector("small").textContent = detail;
  element.querySelector("small").hidden = !detail;
  if (onOpen) {
    element.type = "button";
    const arrow = document.createElement("i");
    arrow.className = "icon chevron";
    arrow.setAttribute("aria-hidden", "true");
    element.append(arrow);
    element.addEventListener("click", onOpen);
  }
  return element;
}

function renderJournal() {
  renderCalendar();
  const entries = state.entries.filter((entry) => entry.date === selected);
  $("#day-title").textContent = dayName.format(parseDate(selected));
  $("#day-count").textContent = countLabel(entries.length);
  const rows = entries.map((entry) => row(
    exerciseName(entry.exerciseId),
    entry.sets + " × " + entry.reps + " повт." + (entry.weight === null ? "" : "  ·  " + numbers.format(entry.weight) + " кг"),
    () => openEntry(entry)
  ));
  $("#day-entries").replaceChildren(...(rows.length ? rows : [row("Записей пока нет", "Добавьте упражнение за этот день.")]));
  renderMuscleTotals(entries);
}

function renderMuscleTotals(entries) {
  const section = $("#muscle-totals");
  section.hidden = entries.length === 0;
  if (section.hidden) return;

  const groupNames = new Map(state.muscleGroups.map((group) => [group.id, group.name]));
  const exerciseGroups = new Map(state.exercises.map((exercise) => [exercise.id, exercise.groupId]));
  const totals = new Map();

  for (const entry of entries) {
    const assignedGroup = exerciseGroups.get(entry.exerciseId);
    const groupId = groupNames.has(assignedGroup) ? assignedGroup : null;
    const total = totals.get(groupId) ?? { sets: 0, reps: 0 };
    total.sets += entry.sets;
    total.reps += entry.sets * entry.reps;
    totals.set(groupId, total);
  }

  const sortedGroups = [...state.muscleGroups].sort(byName);
  sortedGroups.push({ id: null, name: "Без группы" });
  const rows = document.createDocumentFragment();
  for (const group of sortedGroups) {
    const total = totals.get(group.id);
    if (!total) continue;
    const tr = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = group.name;
    tr.append(name);
    tr.insertCell().textContent = numbers.format(total.sets);
    tr.insertCell().textContent = numbers.format(total.reps);
    rows.append(tr);
  }
  $("#muscle-total-rows").replaceChildren(rows);
}

function renderCatalog() {
  const active = state.exercises.filter((exercise) => !exercise.archived).sort(byName);
  const groupNames = new Map(state.muscleGroups.map((group) => [group.id, group.name]));
  const rows = active.map((exercise) => row(exercise.name, groupNames.get(exercise.groupId) ?? "", () => {
    renderExerciseStats(exercise.id);
    stats.showModal();
    stats.scrollTop = 0;
  }));
  $("#exercise-list").replaceChildren(...(rows.length ? rows : [row("Список пока пуст", "Добавьте своё первое упражнение.")]));
}

function renderMuscleGroups() {
  const groups = [...state.muscleGroups].sort(byName);
  const rows = groups.map((group) => row(group.name, "", () => openGroup(group)));
  $("#muscle-group-list").replaceChildren(...(rows.length ? rows : [row("Список пока пуст", "Добавьте свою первую группу мышц.")]));
}

function exerciseResults(exerciseId) {
  let record = null;
  let lastDate = "";
  let latest = [];

  for (const entry of state.entries) {
    if (entry.exerciseId !== exerciseId) continue;
    if (entry.date > lastDate) {
      lastDate = entry.date;
      latest = [entry];
    } else if (entry.date === lastDate) {
      latest.push(entry);
    }
    if (Number.isFinite(entry.weight) && (!record || entry.weight > record.weight ||
        (entry.weight === record.weight && entry.date >= record.date))) {
      record = entry;
    }
  }
  return { record, lastDate, latest };
}

function statisticRow(entry, tag) {
  const element = document.createElement(tag);
  element.className = "stats-result";
  const weight = document.createElement("strong");
  weight.textContent = entry.weight == null ? "Вес не указан" : numbers.format(entry.weight) + " кг";
  const detail = document.createElement("span");
  const sets = plural(entry.sets, ["подход", "подхода", "подходов"]);
  detail.textContent = entry.sets + " " + sets + " · " + entry.reps + " повт. за подход";
  element.append(weight, detail);
  return element;
}

function renderExerciseStats(exerciseId) {
  const { record, lastDate, latest } = exerciseResults(exerciseId);
  stats.dataset.exerciseId = exerciseId;
  $("#stats-title").textContent = exerciseName(exerciseId);
  $("#stats-empty").hidden = latest.length > 0;
  $("#stats-results").hidden = latest.length === 0;
  if (!latest.length) return;

  const recordDate = $("#record-date");
  const recordResult = $("#record-result");
  recordDate.hidden = !record;
  if (record) {
    recordDate.textContent = fullDate.format(parseDate(record.date));
    recordResult.replaceChildren(statisticRow(record, "div"));
  } else {
    const message = document.createElement("p");
    message.className = "stats-message";
    message.textContent = "Вес пока не указан ни в одной записи.";
    recordResult.replaceChildren(message);
  }
  $("#last-date").textContent = fullDate.format(parseDate(lastDate));
  $("#last-results").replaceChildren(...latest.map((entry) => statisticRow(entry, "li")));
}

function changeMonth(offset) {
  const day = parseDate(selected).getDate();
  visibleMonth.setMonth(visibleMonth.getMonth() + offset);
  const end = new Date(visibleMonth);
  end.setMonth(end.getMonth() + 1, 0);
  const date = new Date(visibleMonth);
  date.setDate(Math.min(day, end.getDate()));
  selected = dateKey(date);
  renderJournal();
}

function startEditor(context, title, fields) {
  editContext = context;
  $("#editor-title").textContent = title;
  $("#editor-fields").innerHTML = fields;
  $("#editor-error").hidden = true;
  $("#delete-item").hidden = !context.item;
}

function openExercise(item = null, returnToEntry = false) {
  startEditor({ type: "exercise", item, returnToEntry }, item ? "Редактировать упражнение" : "Новое упражнение",
    '<label>Название<input name="name" type="text" maxlength="100" required autocomplete="off" placeholder="Например, жим лёжа" autofocus></label>' +
    '<label>Целевая группа мышц<select name="groupId"></select></label>' +
    '<p id="group-field-help" class="field-description" hidden>Справочник групп доступен в разделе «Упражнения».</p>');
  editorForm.elements.name.value = item?.name ?? "";
  const select = editorForm.elements.groupId;
  select.add(new Option("Без группы", ""));
  for (const group of [...state.muscleGroups].sort(byName)) {
    select.add(new Option(group.name, group.id));
  }
  select.value = item?.groupId ?? "";
  $("#group-field-help").hidden = state.muscleGroups.length > 0;
  editor.showModal();
}

function openGroup(item = null) {
  startEditor({ type: "group", item }, item ? "Редактировать группу" : "Новая группа мышц",
    '<label>Название<input name="name" type="text" maxlength="100" required autocomplete="off" placeholder="Например, грудь" autofocus></label>');
  editorForm.elements.name.value = item?.name ?? "";
  editor.showModal();
}

function openEntry(item = null, exerciseId = "") {
  const available = state.exercises.filter((exercise) => !exercise.archived || exercise.id === item?.exerciseId);
  if (available.length === 0) {
    openExercise(null, true);
    return;
  }
  startEditor({ type: "entry", item, date: item?.date ?? selected }, item ? "Редактировать запись" : "Новая запись",
    '<label>Упражнение<select name="exerciseId" required autofocus></select></label>' +
    '<div class="fields">' +
    '<label>Подходы<input name="sets" type="number" inputmode="numeric" min="1" max="9999" step="1" required></label>' +
    '<label>Повторения<input name="reps" type="number" inputmode="numeric" min="1" max="9999" step="1" required></label>' +
    '<label>Вес, кг<input name="weight" type="text" inputmode="decimal" placeholder="—" autocomplete="off" pattern="[0-9]+([.,][0-9]{1,3})?" maxlength="12"></label>' +
    '</div><p class="field-description">Укажите число повторений за один подход. Вес можно оставить пустым.</p>');
  const select = editorForm.elements.exerciseId;
  select.add(new Option("Выберите упражнение", ""));
  available.sort(byName);
  for (const exercise of available) select.add(new Option(exercise.name, exercise.id));
  select.value = item?.exerciseId ?? exerciseId;
  editorForm.elements.sets.value = item?.sets ?? "";
  editorForm.elements.reps.value = item?.reps ?? "";
  editorForm.elements.weight.value = item?.weight == null ? "" : String(item.weight).replace(".", ",");
  editor.showModal();
}

function showEditorError(message) {
  const error = $("#editor-error");
  error.textContent = message;
  error.hidden = false;
}

function submitEditor(event) {
  event.preventDefault();
  const { type, item, date, returnToEntry } = editContext;
  const fields = new FormData(editorForm);
  const id = item?.id ?? newId();
  let nextState;

  if (type === "entry") {
    const weight = String(fields.get("weight"));
    const entry = { id, date, exerciseId: fields.get("exerciseId"), sets: Number(fields.get("sets")),
      reps: Number(fields.get("reps")), weight: weight === "" ? null : Number(weight.replace(",", ".")) };
    nextState = { ...state, entries: item ? state.entries.map((row) => row.id === id ? entry : row) : [...state.entries, entry] };
  } else {
    const exercise = type === "exercise";
    const collection = exercise ? "exercises" : "muscleGroups";
    const items = state[collection];
    const name = String(fields.get("name")).trim().replace(/\s+/g, " ");
    if (!name) return showEditorError("Введите название.");
    if (items.some((entry) => !entry.archived && entry.id !== id && entry.name.toLowerCase() === name.toLowerCase())) {
      return showEditorError(exercise ? "Такое упражнение уже есть в списке." : "Такая группа уже есть в списке.");
    }
    const value = exercise ? { id, name, archived: false, groupId: fields.get("groupId") || null } : { id, name };
    nextState = { ...state, [collection]: item ? items.map((entry) => entry.id === id ? value : entry) : [...items, value] };
  }
  if (!save(nextState)) return showEditorError("Не удалось сохранить изменения.");
  editor.close();
  showScreen(screen);
  if (stats.open) renderExerciseStats(stats.dataset.exerciseId);
  if (muscleGroups.open) renderMuscleGroups();
  if (returnToEntry) openEntry(null, id);
  else showToast("Сохранено");
}

function askDelete() {
  const messages = {
    exercise: ["Удалить упражнение?", "Упражнение исчезнет из списка выбора. Записи тренировок сохранятся."],
    entry: ["Удалить запись?", "Запись будет удалена из журнала."],
    group: ["Удалить группу?", "Её упражнения попадут в строку «Без группы». Записи тренировок сохранятся."]
  };
  const [title, message] = messages[editContext.type];
  $("#confirmation-title").textContent = title;
  $("#confirmation-message").textContent = message;
  confirmation.showModal();
}

function deleteItem() {
  const { type, item } = editContext;
  let nextState;
  if (type === "group") {
    nextState = {
      ...state,
      muscleGroups: state.muscleGroups.filter((group) => group.id !== item.id),
      exercises: state.exercises.map((exercise) => exercise.groupId === item.id ? { ...exercise, groupId: null } : exercise)
    };
  } else if (type === "exercise") {
    nextState = { ...state, exercises: state.exercises.map((exercise) => exercise.id === item.id ? { ...exercise, archived: true } : exercise) };
  } else {
    nextState = { ...state, entries: state.entries.filter((entry) => entry.id !== item.id) };
  }
  confirmation.close();
  if (!save(nextState)) return showEditorError("Не удалось удалить.");
  editor.close();
  if (stats.open && type === "exercise") stats.close();
  showScreen(screen);
  if (muscleGroups.open) renderMuscleGroups();
  showToast("Удалено");
}

function entriesInPeriod(from, to) {
  return state.entries.filter((entry) => entry.date >= from && entry.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function updateExport() {
  const from = exportForm.elements.from.value;
  const to = exportForm.elements.to.value;
  const valid = Boolean(from && to && from <= to);
  const count = valid ? entriesInPeriod(from, to).length : 0;
  $("#export-button").disabled = count === 0;
  $("#export-summary").textContent = valid ? "За этот период: " + countLabel(count) : "Укажите корректный диапазон дат.";
}

const csvFormula = /^'*\s*[=+@\-＝＋－＠]/u;

function csvLabel(label) {
  const safe = csvFormula.test(label) ? "'" + label : label;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function csvText(entries) {
  const columns = "Дата;Упражнение;Подходы;Повторения за подход;Вес (кг)";
  const rows = [native ? columns : columns + ";Группа мышц"];
  const exercises = new Map(state.exercises.map((exercise) => [exercise.id, exercise]));
  const groups = new Map(state.muscleGroups.map((group) => [group.id, group.name]));
  for (const entry of entries) {
    const exercise = exercises.get(entry.exerciseId);
    const row = [
      entry.date, csvLabel(exercise?.name ?? "Упражнение"), entry.sets, entry.reps,
      entry.weight === null ? "" : String(entry.weight).replace(".", ",")
    ];
    if (!native) row.push(csvLabel(groups.get(exercise?.groupId) ?? ""));
    rows.push(row.join(";"));
  }
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}

function exportEntries(event) {
  event.preventDefault();
  const from = exportForm.elements.from.value;
  const to = exportForm.elements.to.value;
  const entries = entriesInPeriod(from, to);
  if (!from || !to || from > to || !entries.length) return;
  const filename = "gymbro_" + from + "_" + to + ".csv";
  const content = csvText(entries);
  if (native) {
    if (!native.createCsv(filename, content)) showToast("Не удалось подготовить файл");
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.handleAndroidBack = () => {
  if (confirmation.open) confirmation.close();
  else if (editor.open) editor.close();
  else if (stats.open) stats.close();
  else if (muscleGroups.open) muscleGroups.close();
  else if (screen !== "journal") showScreen("journal");
  else return false;
  return true;
};

for (const button of document.querySelectorAll("[data-screen]")) {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
}
$("#calendar-days").addEventListener("click", (event) => {
  const key = event.target.closest("[data-date]")?.dataset.date;
  if (!key) return;
  selected = key;
  renderJournal();
});
$("#month-prev").addEventListener("click", () => changeMonth(-1));
$("#month-next").addEventListener("click", () => changeMonth(1));
$("#today").addEventListener("click", () => {
  selected = dateKey(new Date());
  visibleMonth = monthStart(parseDate(selected));
  showScreen("journal");
  window.scrollTo(0, 0);
});
$("#add-entry").addEventListener("click", () => openEntry());
$("#add-exercise").addEventListener("click", () => openExercise());
$("#manage-groups").addEventListener("click", () => {
  renderMuscleGroups();
  muscleGroups.showModal();
  muscleGroups.scrollTop = 0;
});
$("#close-groups").addEventListener("click", () => muscleGroups.close());
$("#add-group").addEventListener("click", () => openGroup());
$("#close-stats").addEventListener("click", () => stats.close());
$("#edit-exercise").addEventListener("click", () => {
  const exercise = state.exercises.find((item) => item.id === stats.dataset.exerciseId);
  if (exercise) openExercise(exercise);
});
$("#close-editor").addEventListener("click", () => editor.close());
$("#delete-item").addEventListener("click", askDelete);
$("#cancel-delete").addEventListener("click", () => confirmation.close());
$("#confirm-delete").addEventListener("click", deleteItem);
editorForm.addEventListener("submit", submitEditor);
exportForm.addEventListener("input", updateExport);
exportForm.addEventListener("submit", exportEntries);
exportForm.elements.from.value = dateKey(visibleMonth);
exportForm.elements.to.value = selected;
showScreen("journal");
