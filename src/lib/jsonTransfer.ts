type JsonChoice = 'file' | 'clipboard';

export const showTwoOptionModal = <TFirst extends string, TSecond extends string>(
  title: string,
  message: string,
  firstLabel: string,
  firstValue: TFirst,
  secondLabel: string,
  secondValue: TSecond,
): Promise<TFirst | TSecond | null> => (
  new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.background = 'rgba(2, 6, 23, 0.72)';
    overlay.style.backdropFilter = 'blur(4px)';

    const panel = document.createElement('div');
    panel.style.width = 'min(420px, calc(100vw - 32px))';
    panel.style.border = '1px solid rgba(34, 211, 238, 0.35)';
    panel.style.borderRadius = '16px';
    panel.style.background = 'linear-gradient(135deg, rgba(12, 18, 31, 0.98), rgba(7, 10, 18, 0.98))';
    panel.style.boxShadow = '0 24px 70px rgba(0, 0, 0, 0.45)';
    panel.style.padding = '18px';
    panel.style.color = '#e0f2fe';

    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.margin = '0 0 8px';
    heading.style.fontSize = '18px';
    heading.style.fontWeight = '800';

    const body = document.createElement('p');
    body.textContent = message;
    body.style.margin = '0 0 16px';
    body.style.color = '#94a3b8';
    body.style.fontSize = '13px';
    body.style.lineHeight = '1.5';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';

    const cleanup = (choice: TFirst | TSecond | null) => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(choice);
    };

    const makeButton = (label: string, choice: TFirst | TSecond | null, accent: string) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.border = `1px solid ${accent}`;
      button.style.borderRadius = '10px';
      button.style.background = choice ? `${accent}26` : 'rgba(15, 23, 42, 0.85)';
      button.style.color = choice ? '#ecfeff' : '#cbd5e1';
      button.style.cursor = 'pointer';
      button.style.fontWeight = '700';
      button.style.padding = '9px 12px';
      button.addEventListener('click', () => cleanup(choice));
      return button;
    };

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') cleanup(null);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(null);
    });
    document.addEventListener('keydown', onKeyDown);

    actions.append(
      makeButton('Cancel', null, 'rgba(100, 116, 139, 0.55)'),
      makeButton(firstLabel, firstValue, 'rgba(16, 185, 129, 0.75)'),
      makeButton(secondLabel, secondValue, 'rgba(56, 189, 248, 0.75)'),
    );
    panel.append(heading, body, actions);
    overlay.append(panel);
    document.body.appendChild(overlay);
  })
);

const showJsonChoiceModal = (
  title: string,
  message: string,
  fileLabel: string,
  clipboardLabel: string,
): Promise<JsonChoice | null> => showTwoOptionModal(title, message, fileLabel, 'file', clipboardLabel, 'clipboard');

export const downloadJsonFile = (payload: unknown, fileName: string) => {
  const serialized = JSON.stringify(payload, null, 2);
  const blob = new Blob([serialized], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportJsonWithChoice = async (payload: unknown, fileName: string) => {
  const choice = await showJsonChoiceModal(
    'Export JSON',
    'Choose whether to download a JSON file or copy the same JSON data to your clipboard.',
    'Create JSON',
    'Copy to Clipboard',
  );
  if (!choice) return;

  const serialized = JSON.stringify(payload, null, 2);
  if (choice === 'clipboard') {
    await navigator.clipboard.writeText(serialized);
    window.alert('JSON copied to clipboard.');
    return;
  }

  downloadJsonFile(payload, fileName);
};

const readJsonFileText = (): Promise<string | null> => (
  new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(await file.text());
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  })
);

export const importJsonTextWithChoice = async (): Promise<string | null> => {
  const choice = await showJsonChoiceModal(
    'Import JSON',
    'Choose whether to import from a JSON file or try the JSON currently copied to your clipboard.',
    'Import JSON',
    'Import from Clipboard',
  );
  if (!choice) return null;

  if (choice === 'clipboard') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        window.alert('Clipboard is empty.');
        return null;
      }
      return text;
    } catch {
      window.alert('Browser blocked clipboard access. Try Import JSON instead.');
      return null;
    }
  }

  return readJsonFileText();
};
