// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Smoke test: importing main.ts auto-runs render(). If any q() selector is
 * missing or a template throws, the import itself fails. We then drive the
 * crypto-free interactions (quiz, sliders, theme) to catch wiring regressions.
 */
describe('UI mounts and wires up', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    // Importing main runs render() + wireEvents(); a missing selector throws here.
    await import('./main');
  });

  it('renders all six exhibits plus notes', () => {
    for (const id of ['ex1', 'ex2', 'ex3', 'ex4', 'ex5', 'ex6']) {
      expect(document.getElementById(id), `missing ${id}`).toBeTruthy();
    }
    expect(document.getElementById('notes-heading')).toBeTruthy();
  });

  it('mounts the interactive controls', () => {
    for (const id of ['garble-and', 'run-ot', 'run-full', 'proto-step', 'proto-back', 'run-reuse', 'god-view', 'theme-toggle']) {
      expect(document.getElementById(id), `missing ${id}`).toBeTruthy();
    }
    // stage placeholders are present before any run
    expect(document.querySelector('#and-stage .empty-stage')).toBeTruthy();
    expect(document.querySelector('#circuit-stage .empty-stage')).toBeTruthy();
  });

  it('quizzes give feedback when answered', () => {
    const correct = document.querySelector<HTMLButtonElement>('#quiz-m1 .quiz-opt[data-idx="1"]')!;
    correct.click();
    const fb = document.querySelector('#quiz-m1 .quiz-feedback')!;
    expect(fb.textContent).toContain('Correct');
    expect(correct.classList.contains('quiz-correct')).toBe(true);
  });

  it('wealth slider updates its output', () => {
    const slider = document.getElementById('alice-wealth') as HTMLInputElement;
    slider.value = '72';
    slider.dispatchEvent(new Event('input'));
    expect(document.getElementById('alice-wealth-val')!.textContent).toBe('$72M');
  });

  it('theme toggle flips the document theme', () => {
    const before = document.documentElement.getAttribute('data-theme');
    (document.getElementById('theme-toggle') as HTMLButtonElement).click();
    const after = document.documentElement.getAttribute('data-theme');
    expect(after).not.toBe(before);
  });

  const hasSubtle = !!globalThis.crypto?.subtle;
  const cryptoIt = hasSubtle ? it : it.skip;

  cryptoIt('garbling the AND gate renders four padlock rows', async () => {
    (document.getElementById('garble-and') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const rows = document.querySelectorAll('#and-stage .lock-row');
      expect(rows.length).toBe(4);
    });
  });

  cryptoIt('running and stepping the full circuit lights up gates and narrates them', async () => {
    (document.getElementById('run-full') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector('#circuit-stage .circuit-svg')).toBeTruthy();
      expect(document.querySelector('#proto-meter .meter')).toBeTruthy();
    });
    const stepBtn = document.getElementById('proto-step') as HTMLButtonElement;
    const backBtn = document.getElementById('proto-back') as HTMLButtonElement;
    expect(stepBtn.disabled).toBe(false);
    expect(backBtn.disabled).toBe(true); // nothing to undo yet
    stepBtn.click();
    expect(document.querySelectorAll('#circuit-stage .cnode-on').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('#circuit-stage .cnode-current').length).toBe(1);
    expect(document.getElementById('proto-gate')!.textContent).toContain('Gate 1/');
    expect(backBtn.disabled).toBe(false);
    backBtn.click();
    expect(document.querySelectorAll('#circuit-stage .cnode-current').length).toBe(0);
  });

  cryptoIt('arrow keys step the circuit; modified and boundary presses are left alone', async () => {
    const stage = document.getElementById('circuit-stage')!;
    const arrow = (key: string, init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      stage.dispatchEvent(ev);
      return ev;
    };
    // circuit is at step 0 from the previous test's Back click
    expect(arrow('ArrowLeft').defaultPrevented).toBe(false); // boundary: native scroll keeps working
    expect(arrow('ArrowRight', { altKey: true }).defaultPrevented).toBe(false); // Alt+→ untouched
    expect(arrow('ArrowRight').defaultPrevented).toBe(true);
    expect(document.getElementById('proto-gate')!.textContent).toContain('Gate 1/');
    expect(arrow('ArrowLeft').defaultPrevented).toBe(true);
    expect(document.querySelectorAll('#circuit-stage .cnode-current').length).toBe(0);
  });

  cryptoIt('label-reuse attack deduces Alice’s bit and confirms it', async () => {
    (document.getElementById('run-reuse') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const stage = document.getElementById('reuse-stage')!;
      expect(stage.querySelector('.verdict')).toBeTruthy();
      expect(stage.textContent).toContain('correct ✓');
    });
  });
});
