'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Install affordance, plus service-worker registration.
 *
 * Two genuinely different paths behind one control:
 *
 *   Android / desktop Chrome & Edge — fire `beforeinstallprompt`, which we capture
 *     and replay on click. One tap, native dialog.
 *   iOS Safari — has no install API at all. Nothing can be triggered from
 *     JavaScript, so the only honest thing is to show the user where the button
 *     is (Share, then Add to Home Screen).
 *
 * The iOS branch is checked FIRST, before any reliance on the captured event.
 * Ordering it the other way makes the control appear dead on iOS and, more
 * confusingly, in desktop DevTools device emulation — where the user agent says
 * iPhone but the browser still fires beforeinstallprompt.
 *
 * Browser state is read through useSyncExternalStore rather than an effect that
 * calls setState. navigator and matchMedia do not exist during SSR, and this is
 * exactly the case that hook is for: an external source with a distinct server
 * snapshot, read without a hydration mismatch and without a cascading render.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'oil-install-dismissed'

/** None of these change during a session, so nothing needs to be subscribed to. */
const noopSubscribe = () => () => {}

const isIosSnapshot = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

const isStandaloneSnapshot = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // Safari's own non-standard flag — the only way to detect this on iOS.
  (window.navigator as { standalone?: boolean }).standalone === true

const wasDismissedSnapshot = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    // Private mode and blocked site data both throw; treat as not dismissed.
    return false
  }
}

/** On the server none of this is knowable, so the prompt simply does not render. */
const serverFalse = () => false

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const isIos = useSyncExternalStore(noopSubscribe, isIosSnapshot, serverFalse)
  const isStandalone = useSyncExternalStore(noopSubscribe, isStandaloneSnapshot, serverFalse)
  const wasDismissed = useSyncExternalStore(noopSubscribe, wasDismissedSnapshot, serverFalse)

  useEffect(() => {
    // Registered for everyone, installed or not — the offline shell is useful
    // either way, and a failed registration must never break the page.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  useEffect(() => {
    // setState here is event-driven rather than render-driven, which is fine.
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDismissed(true)

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Nothing to do; the prompt simply returns on the next visit.
    }
  }, [])

  const install = useCallback(async () => {
    // iOS first — see the header comment.
    if (isIos) {
      setShowIosHelp((v) => !v)
      return
    }
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    setDismissed(true)
  }, [isIos, deferred])

  // iOS shows immediately since there is no event to wait for; everywhere else
  // waits for the browser to say the app is actually installable.
  const eligible = (isIos || deferred !== null) && !isStandalone && !wasDismissed && !dismissed
  if (!eligible) return null

  return (
    <div
      className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 z-40 card p-4"
      style={{ borderColor: 'rgba(0,255,198,0.35)' }}
      role="dialog"
      aria-label="Install Own It Lower"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium">Install Own It Lower</p>
          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-faint)' }}>
            Add it to your {isIos ? 'home screen' : 'device'} for one-tap access to the screen.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-lg leading-none px-1"
          style={{ color: 'var(--text-faint)' }}
        >
          ×
        </button>
      </div>

      {showIosHelp && (
        <ol
          className="mt-3 text-[12px] leading-relaxed list-decimal pl-4 space-y-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          <li>Tap the Share button in Safari&apos;s toolbar</li>
          <li>Scroll down and choose &ldquo;Add to Home Screen&rdquo;</li>
          <li>Tap Add</li>
        </ol>
      )}

      <button
        onClick={install}
        className="mt-3 w-full rounded-lg px-4 py-2 text-[13px] font-medium"
        style={{ background: 'var(--accent)', color: '#050507' }}
      >
        {isIos ? (showIosHelp ? 'Hide steps' : 'Show me how') : 'Install'}
      </button>
    </div>
  )
}
