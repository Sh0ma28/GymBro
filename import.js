"use strict";

const fileInput = $("#import-file");
const importButton = $("#import-button");
const importStatus = $("#import-status");
const columns = ["дата", "упражнение", "подходы", "повторения за подход", "вес (кг)", "группа мышц"];
let pendingRows = [];

function parseCsv(text, delimiter) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  function finishField() {
    fields.push(field);
    field = "";
    closedQuote = false;
  }

  function finishRecord() {
    finishField();
    records.push(fields);
    fields = [];
  }

  function invalidQuotes() {
    return new Error("Проверьте кавычки в строке " + (records.length + 1) + ".");
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
    } else if (char === delimiter) {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRecord();
    } else if (closedQuote) {
      throw invalidQuotes();
    } else if (char === '"') {
      if (field.length) throw invalidQuotes();
      quoted = true;
    } else {
      field += char;
    }
  }

  if (quoted) throw invalidQuotes();
  if (fields.length || field.length || closedQuote) finishRecord();
  return records;
}

function cleanLabel(value) {
  const label = value.trim().replace(/\s+/g, " ").normalize("NFC");
  return label.startsWith("'") && csvFormula.test(label) ? label.slice(1) : label;
}

function nameKey(value) {
  return value.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

function csvDate(value) {
  const local = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const date = local ? local[3] + "-" + local[2].padStart(2, "0") + "-" + local[1].padStart(2, "0") : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 4) !== "0000" &&
    dateKey(parseDate(date)) === date ? date : "";
}

function workoutRows(text) {
  const source = text.replace(/^\uFEFF/, "").replace(/^sep=[;,]\r?\n/i, "");
  const header = source.split(/\r\n|\r|\n/, 1)[0];
  for (const delimiter of [";", ","]) {
    let headings;
    try {
      headings = parseCsv(header, delimiter)[0]?.map(nameKey) ?? [];
    } catch {
      continue;
    }
    const indexes = columns.map((column) => headings.indexOf(column));
    if (indexes.slice(0, 5).includes(-1) || new Set(headings).size !== headings.length) continue;
    const records = parseCsv(source, delimiter);
    const rows = [];

    for (const [index, record] of records.entries()) {
      if (index === 0 || record.every((cell) => !cell.trim())) continue;
      const [rawDate, rawName, rawSets, rawReps, rawWeight, rawGroup] = indexes.map((i) => (record[i] ?? "").trim());
      const date = csvDate(rawDate);
      const name = cleanLabel(rawName);
      const group = cleanLabel(rawGroup);
      const validCount = /^[0-9]{1,4}$/;
      const validWeight = /^[0-9]+([.,][0-9]{1,3})?$/;
      if (record.length !== headings.length || !date || !name || name.length > 100 || group.length > 100 ||
          !validCount.test(rawSets) || Number(rawSets) < 1 || !validCount.test(rawReps) || Number(rawReps) < 1 ||
          (rawWeight && (rawWeight.length > 12 || !validWeight.test(rawWeight)))) {
        throw new Error("Проверьте дату, упражнение, подходы, повторения и вес в строке " + (index + 1) + ".");
      }
      rows.push({ date, name, group, sets: Number(rawSets), reps: Number(rawReps),
        weight: rawWeight === "" ? null : Number(rawWeight.replace(",", ".")) });
    }
    if (!rows.length) throw new Error("В файле нет записей тренировок.");
    return rows;
  }
  throw new Error("Не найдены столбцы журнала. Выберите CSV, выгруженный из GymBro или «Ритма».");
}

function trainingKey(entry, name) {
  return JSON.stringify([entry.date, nameKey(name), entry.sets, entry.reps, entry.weight]);
}

function planImport(rows, journal) {
  const exercises = new Map(journal.exercises.map((exercise) => [exercise.id, exercise]));
  const activeByName = new Map(journal.exercises.filter((exercise) => !exercise.archived)
    .map((exercise) => [nameKey(exercise.name), exercise.id]));
  const groups = new Map(journal.muscleGroups.map((group) => [nameKey(group.name), group]));
  const existing = new Map();
  for (const entry of journal.entries) {
    const key = trainingKey(entry, exercises.get(entry.exerciseId)?.name ?? "Упражнение");
    existing.set(key, (existing.get(key) ?? 0) + 1);
  }

  const added = [];
  let skipped = 0;
  let assignments = 0;
  for (const row of rows) {
    const key = trainingKey(row, row.name);
    const remaining = existing.get(key) ?? 0;
    const duplicate = remaining > 0;
    if (duplicate) {
      existing.set(key, remaining - 1);
      skipped++;
    }

    const exerciseKey = nameKey(row.name);
    let exercise = exercises.get(activeByName.get(exerciseKey));
    if (!exercise) {
      if (duplicate) continue;
      exercise = { id: newId(), name: row.name, archived: false, groupId: null };
      exercises.set(exercise.id, exercise);
      activeByName.set(exerciseKey, exercise.id);
    }

    if (row.group && !exercise.groupId) {
      const groupKey = nameKey(row.group);
      let group = groups.get(groupKey);
      if (!group) {
        group = { id: newId(), name: row.group };
        groups.set(groupKey, group);
      }
      exercise = { ...exercise, groupId: group.id };
      exercises.set(exercise.id, exercise);
      assignments++;
    }
    if (!duplicate) {
      added.push({ id: newId(), exerciseId: exercise.id, date: row.date, sets: row.sets,
        reps: row.reps, weight: row.weight });
    }
  }
  return {
    added: added.length,
    skipped,
    assignments,
    journal: { ...journal, exercises: [...exercises.values()], muscleGroups: [...groups.values()], entries: [...journal.entries, ...added] }
  };
}

function importMessage(message, error = false) {
  importStatus.textContent = message;
  importStatus.toggleAttribute("data-error", error);
  importStatus.hidden = !message;
}

function importSummary(plan) {
  const labels = ["Новые записи — " + plan.added, "совпадения — " + plan.skipped];
  if (plan.assignments) labels.push("назначения групп — " + plan.assignments);
  return labels.join(", ") + ".";
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  pendingRows = [];
  importButton.disabled = true;
  importMessage(file ? "Читаю CSV…" : "");
  if (!file) return;
  try {
    const bytes = await file.arrayBuffer();
    if (fileInput.files[0] !== file) return;
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Сохраните файл как CSV в кодировке UTF-8.");
    }
    pendingRows = workoutRows(content);
    const plan = planImport(pendingRows, state);
    importMessage(importSummary(plan));
    importButton.disabled = !(plan.added || plan.assignments);
  } catch (error) {
    if (fileInput.files[0] === file) importMessage(error.message, true);
  }
});

importButton.addEventListener("click", () => {
  if (!pendingRows.length) return;
  try {
    const saved = localStorage.getItem(storageKey);
    const current = saved ? { muscleGroups: [], ...JSON.parse(saved) } : state;
    const plan = planImport(pendingRows, current);
    if ((plan.added || plan.assignments) && !save(plan.journal)) throw new Error();
    state = plan.journal;
    pendingRows = [];
    fileInput.value = "";
    importButton.disabled = true;
    updateExport();
    importMessage("Готово. " + importSummary(plan));
  } catch {
    importMessage("Не удалось сохранить записи в браузере.", true);
  }
});
