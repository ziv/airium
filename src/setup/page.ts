import { createLocationMap } from './location-map';
import { AIRCRAFT_IDS } from '../aircraft';
import { MISSION_IDS } from '../missions';
import { defaultSettings, validateSettings, type Settings } from './settings';

const labelFor = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
const labels: Record<string, string> = {
  lat: 'Latitude (degrees)',
  lon: 'Longitude (degrees)',
  height: 'Height above terrain (m)',
  heading: 'Heading (degrees)',
  speed: 'Initial airspeed (m/s)',
  fov: 'Field of view (degrees)',
  time: 'Date and time (UTC · blank = now)',
};

/** Build controls from the actual configuration so newly added properties remain editable. */
export function showSetup(): Promise<Settings> {
  let draft: Settings;
  let initialError = '';
  try {
    draft = validateSettings(defaultSettings(window.location.search));
  } catch (error) {
    draft = defaultSettings();
    initialError = `URL settings could not be loaded: ${String(error)}`;
  }
  const root = document.createElement('main');
  root.id = 'flight-setup';
  document.body.append(root);
  return new Promise((resolve) => {
    let disposeMap = () => {};
    const render = () => {
      disposeMap();
      root.innerHTML = `<form class="setup-shell"><header><p class="eyebrow">AIRIUM / FLIGHT OPERATIONS</p><h1>Flight setup</h1></header><div class="setup-primary"><div class="flight-fields"></div><section class="map-panel"></section></div><div class="setup-fields"></div><footer><p class="setup-error" role="alert" tabindex="-1"></p><div class="setup-actions"><button type="button" class="restore">Restore defaults</button><span>All distances in metres, speeds in m/s, angles in degrees unless labelled.</span><button type="submit" class="launch">Start flight →</button></div></footer></form>`;
      const form = root.querySelector('form')!;
      const fields = root.querySelector<HTMLElement>('.setup-fields')!;
      const errorBox = root.querySelector<HTMLElement>('.setup-error')!;
      errorBox.textContent = initialError;
      const readers: (() => void)[] = [];
      function section(parent: HTMLElement, title: string, open = false): HTMLElement {
        const details = document.createElement('details');
        details.open = open;
        const summary = document.createElement('summary');
        summary.textContent = title;
        const content = document.createElement('div');
        content.className = 'field-grid';
        details.append(summary, content);
        parent.append(details);
        return content;
      }
      function controls(parent: HTMLElement, object: object, path: string) {
        const record = object as Record<string, unknown>;
        for (const [key, value] of Object.entries(record)) {
          if (key === 'id') continue;
          const full = `${path}.${key}`;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            controls(section(parent, labelFor(key)), value, full);
            continue;
          }
          const label = document.createElement('label');
          const title = document.createElement('span');
          title.textContent = path === 'sim.start' ? (labels[key] ?? labelFor(key)) : labelFor(key);
          label.append(title);
          let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          const options =
            full === 'sim.start.aircraft'
              ? AIRCRAFT_IDS
              : full === 'sim.start.mission'
                ? ['', ...MISSION_IDS]
                : full === 'ai.difficulty'
                  ? ['easy', 'medium', 'hard']
                  : full === 'sim.graphics.preset'
                    ? Object.keys(draft.sim.graphics.presets)
                    : full === 'sim.hud.units'
                      ? ['imperial', 'metric']
                      : null;
          if (options) {
            input = document.createElement('select');
            for (const id of options) {
              const option = document.createElement('option');
              option.value = id;
              option.textContent =
                full === 'sim.start.aircraft'
                  ? draft.aircraft[id]!.name
                  : full === 'sim.start.mission'
                    ? id
                      ? draft.missions[id]!.name
                      : 'Free flight (empty world)'
                    : labelFor(id);
              input.append(option);
            }
            input.value = String(value);
          } else if (Array.isArray(value)) {
            input = document.createElement('textarea');
            input.value = JSON.stringify(value, null, 2);
            input.rows = 5;
            title.textContent += ' (JSON)';
            label.className = 'wide-field';
          } else {
            input = document.createElement('input');
            input.type =
              typeof value === 'boolean'
                ? 'checkbox'
                : typeof value === 'number'
                  ? 'number'
                  : full === 'sim.start.time'
                    ? 'datetime-local'
                    : 'text';
            if (typeof value === 'number') {
              input.step = 'any';
              input.required = true;
            }
            if (typeof value === 'boolean') input.checked = value;
            else
              input.value =
                full === 'sim.start.time' && value
                  ? new Date(String(value)).toISOString().slice(0, 19)
                  : String(value ?? '');
            if (full === 'sim.start.time') input.step = '1';
          }
          input.name = full;
          input.setAttribute('aria-label', title.textContent ?? key);
          readers.push(() => {
            try {
              record[key] = Array.isArray(value)
                ? JSON.parse(input.value)
                : typeof value === 'boolean'
                  ? (input as HTMLInputElement).checked
                  : typeof value === 'number'
                    ? Number(input.value)
                    : full === 'sim.start.time' && input.value
                      ? new Date(`${input.value}Z`).toISOString()
                      : value === null && !input.value
                        ? null
                        : input.value;
            } catch {
              throw new Error(
                `Check ${full}: enter ${Array.isArray(value) ? 'valid JSON' : 'a valid value'}.`,
              );
            }
          });
          label.append(input);
          parent.append(label);
        }
      }
      controls(
        section(
          root.querySelector<HTMLElement>('.flight-fields')!,
          'Mission & flight conditions',
          true,
        ),
        draft.sim.start,
        'sim.start',
      );
      controls(section(fields, 'Aircraft properties & loadouts'), draft.aircraft, 'aircraft');
      controls(section(fields, 'AI & difficulty'), draft.ai, 'ai');
      for (const key of [
        'graphics',
        'hud',
        'input',
        'camera',
        'environment',
        'ground',
        'simulation',
        'world',
        'ion',
      ] as const) {
        controls(section(fields, labelFor(key)), draft.sim[key], `sim.${key}`);
      }
      controls(section(fields, 'Weapons & countermeasures'), draft.weapons, 'weapons');
      controls(section(fields, 'Radar & sensors'), draft.sensors, 'sensors');
      controls(section(fields, 'Mission entities & routes'), draft.missions, 'missions');
      controls(section(fields, 'Surface unit properties'), draft.units, 'units');
      disposeMap = createLocationMap(
        root.querySelector<HTMLElement>('.map-panel')!,
        root.querySelector<HTMLInputElement>('[name="sim.start.lat"]')!,
        root.querySelector<HTMLInputElement>('[name="sim.start.lon"]')!,
      );
      root.querySelector('.restore')!.addEventListener('click', () => {
        draft = defaultSettings();
        initialError = '';
        render();
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          readers.forEach((read) => read());
          const settings = validateSettings(draft);
          disposeMap();
          root.remove();
          resolve(settings);
        } catch (error) {
          errorBox.textContent = error instanceof Error ? error.message : String(error);
          errorBox.focus();
        }
      });
    };
    render();
  });
}
