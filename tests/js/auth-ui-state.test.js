import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function loadAuthUiState() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'js/network/auth-ui-state.js'),
    'utf8',
  );
  window.eval(source);
  return window.AuthUiState;
}

describe('AuthUiState shared Galaxy stage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.AuthUiState;
  });

  it('does not treat the shared Galaxy background as the game section', () => {
    const stage = document.createElement('section');
    stage.id = 'wm-galaxy-section';
    const auth = document.createElement('section');
    auth.id = 'auth-section';
    document.body.append(stage, auth);

    const authUiState = loadAuthUiState();
    authUiState.setGameSectionVisible(false);

    expect(stage.classList.contains('hidden')).toBe(false);
    expect(authUiState.getElement('gameSection')).toBeNull();
  });

  it('still toggles the dedicated game section', () => {
    const game = document.createElement('section');
    game.id = 'game-section';
    document.body.append(game);

    const authUiState = loadAuthUiState();
    authUiState.setGameSectionVisible(false);
    expect(game.classList.contains('hidden')).toBe(true);

    authUiState.setGameSectionVisible(true);
    expect(game.classList.contains('hidden')).toBe(false);
  });
});
