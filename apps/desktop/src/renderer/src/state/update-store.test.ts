import { describe, expect, it } from 'vitest';
import { createUpdateStore } from './update-store';

describe('update-store', () => {
  it('starts idle', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    expect(store.getState().status).toBe('idle');
  });

  it('transitions to available when update-available received', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    store.getState().markDismissedVersionReady('');
    store.getState().setAvailable({ version: '0.2.0', releaseUrl: 'https://x/y' });
    expect(store.getState().status).toBe('available');
    expect(store.getState().version).toBe('0.2.0');
    expect(store.getState().shouldShowBanner()).toBe(true);
  });

  it('hides banner when the available version equals dismissedVersion', () => {
    const store = createUpdateStore({ dismissedVersion: '0.2.0' });
    store.getState().markDismissedVersionReady('0.2.0');
    store.getState().setAvailable({ version: '0.2.0', releaseUrl: 'https://x/y' });
    expect(store.getState().shouldShowBanner()).toBe(false);
  });

  it('shows banner again when a NEWER version arrives', () => {
    const store = createUpdateStore({ dismissedVersion: '0.2.0' });
    store.getState().markDismissedVersionReady('0.2.0');
    store.getState().setAvailable({ version: '0.2.1', releaseUrl: 'https://x/y' });
    expect(store.getState().shouldShowBanner()).toBe(true);
  });

  it('dismiss() updates dismissedVersion and hides banner', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    store.getState().markDismissedVersionReady('');
    store.getState().setAvailable({ version: '0.2.0', releaseUrl: 'https://x/y' });
    store.getState().dismiss();
    expect(store.getState().dismissedVersion).toBe('0.2.0');
    expect(store.getState().shouldShowBanner()).toBe(false);
  });

  it('hides banner until markDismissedVersionReady is called (prevents dismissed-version flash race)', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    // Event arrives before prefs have seeded the dismissed version.
    store.getState().setAvailable({ version: '0.2.0', releaseUrl: 'https://x/y' });
    expect(store.getState().shouldShowBanner()).toBe(false);
    // Prefs resolve and seed a NEWER dismissed version than the event.
    store.getState().markDismissedVersionReady('0.2.0');
    expect(store.getState().shouldShowBanner()).toBe(false);
  });

  it('shows banner when a newer version arrives before prefs resolve', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    store.getState().setAvailable({ version: '0.3.0', releaseUrl: 'https://x/y' });
    expect(store.getState().shouldShowBanner()).toBe(false);
    store.getState().markDismissedVersionReady('0.2.0');
    expect(store.getState().shouldShowBanner()).toBe(true);
  });

  it('markDismissedVersionReady also updates dismissedVersion', () => {
    const store = createUpdateStore({ dismissedVersion: '' });
    store.getState().markDismissedVersionReady('0.1.9');
    expect(store.getState().dismissedVersion).toBe('0.1.9');
    expect(store.getState().dismissedVersionReady).toBe(true);
  });
});
