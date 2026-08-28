#!/usr/bin/env bash
#
# Description: Modular Git commit signature and sign-off helper.
#

execute_commit() {
  local commit_msg="$1"
  local branch="$2"

  echo "Staging changes..." >&2
  # Stage the changes cleanly
  git add -A

  echo "Creating conventional signed commit on branch '$branch'..." >&2

  # Perform GPG-signed or SSH-signed commit natively with mandatory sign-off (-s)
  if ! git commit -S -s -m "$commit_msg"; then
    echo "======================================================================" >&2
    echo "❌ GPG/SSH COMMIT SIGNATURE FAILURE!" >&2
    echo "   The git commit signature operation failed or was cancelled." >&2
    echo "   " >&2
    echo "   💡 HEADLESS TTY GPG/SSH LOCKOUT DETECTED?" >&2
    echo "   Because the commit is triggered from an automated hook subprocess," >&2
    echo "   your GPG/SSH pinentry/Touch ID prompt lacks a standard terminal TTY." >&2
    echo "   " >&2
    echo "   To resolve this and allow headless biometric commit signing:" >&2
    echo "   1. For GPG (macOS/Darwin):" >&2
    echo "      Install and configure pinentry-mac to show a native GUI prompt:" >&2
    echo "        brew install pinentry-mac" >&2
    echo "        echo 'pinentry-program /opt/homebrew/bin/pinentry-mac' >> ~/.gnupg/gpg-agent.conf" >&2
    echo "        gpgconf --kill gpg-agent" >&2
    echo "   2. For GPG (Linux/Linux-based VMs):" >&2
    echo "      Configure a GUI pinentry program (like pinentry-gnome or pinentry-qt) in your agent conf." >&2
    echo "   3. For SSH-based Signing:" >&2
    echo "      Ensure your SSH agent is unlocked and has cached your identity:" >&2
    echo "        ssh-add ~/.gemini/ssh-key" >&2
    echo "======================================================================" >&2
    exit 1
  fi

  echo "✅ Conventional GPG/SSH-signed commit successfully created!" >&2
}
