import { useState, useEffect, useCallback } from 'react';
import * as serverApi from '../api/server';

type VerificationStep = 'enter_username' | 'show_code' | 'checking' | 'verified' | 'error';

interface VerificationPanelProps {
  onVerified?: (player: serverApi.ServerPlayer) => void;
  initialUsername?: string;
}

export function VerificationPanel({ onVerified, initialUsername }: VerificationPanelProps) {
  const [step, setStep] = useState<VerificationStep>('enter_username');
  const [username, setUsername] = useState(initialUsername || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationData, setVerificationData] = useState<serverApi.VerificationCodeResponse | null>(null);
  const [serverPlayer, setServerPlayer] = useState<serverApi.ServerPlayer | null>(null);
  const [checkAttempts, setCheckAttempts] = useState(0);

  // Check if user is already verified when username changes
  useEffect(() => {
    if (initialUsername) {
      checkExistingPlayer(initialUsername);
    }
  }, [initialUsername]);

  const checkExistingPlayer = async (uname: string) => {
    try {
      const player = await serverApi.getPlayer(uname);
      if (player) {
        setServerPlayer(player);
        if (player.is_verified) {
          setStep('verified');
          onVerified?.(player);
        }
      }
    } catch {
      // Player not found on server, that's ok
    }
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // First, check if user exists on iNaturalist and register them
      const inatResponse = await fetch(
        `https://api.inaturalist.org/v1/users/autocomplete?q=${encodeURIComponent(username.trim())}`
      );
      const inatData = await inatResponse.json() as {
        results?: Array<{ id: number; login: string; name?: string; icon_url?: string }>;
      };

      const user = inatData.results?.find(
        (u) => u.login.toLowerCase() === username.trim().toLowerCase()
      );

      if (!user) {
        throw new Error('User not found on iNaturalist. Please check the username.');
      }

      // Register/get player on our server
      const player = await serverApi.registerPlayer({
        inat_user_id: user.id,
        inat_username: user.login,
        inat_display_name: user.name,
        inat_icon_url: user.icon_url,
      });

      setServerPlayer(player);

      // Check if already verified
      if (player.is_verified) {
        setStep('verified');
        onVerified?.(player);
        return;
      }

      // Generate verification code
      const verification = await serverApi.generateVerificationCode(player.id);
      setVerificationData(verification);
      setStep('show_code');
      setCheckAttempts(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to lookup user');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = useCallback(async () => {
    if (!serverPlayer || !verificationData) return;

    setStep('checking');
    setError(null);

    try {
      const result = await serverApi.verifyPlayer(serverPlayer.id);

      if (result.verified && result.player) {
        setServerPlayer(result.player);
        setStep('verified');
        onVerified?.(result.player);
      } else {
        setCheckAttempts((prev) => prev + 1);
        setStep('show_code');
        setError(
          result.message ||
            'Code not found in your bio yet. Make sure to save your profile changes!'
        );
      }
    } catch (e) {
      setStep('show_code');
      setError(e instanceof Error ? e.message : 'Failed to verify');
    }
  }, [serverPlayer, verificationData, onVerified]);

  const handleRegenerateCode = async () => {
    if (!serverPlayer) return;

    setLoading(true);
    setError(null);

    try {
      const verification = await serverApi.generateVerificationCode(serverPlayer.id);
      setVerificationData(verification);
      setCheckAttempts(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate new code');
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    setStep('enter_username');
    setUsername('');
    setError(null);
    setVerificationData(null);
    setServerPlayer(null);
    setCheckAttempts(0);
  };

  // Render based on current step
  if (step === 'verified' && serverPlayer) {
    return (
      <div className="verification-panel verification-success">
        <div className="verification-header">
          <span className="verification-icon">✓</span>
          <h3>Verified!</h3>
        </div>
        <div className="verified-user">
          {serverPlayer.inat_icon_url && (
            <img
              src={serverPlayer.inat_icon_url}
              alt=""
              className="verified-avatar"
            />
          )}
          <div className="verified-info">
            <span className="verified-username">@{serverPlayer.inat_username}</span>
            <span className="verified-status">Identity confirmed</span>
          </div>
        </div>
        <p className="verification-note">
          You can now participate in competitive gameplay, claim tiles, and appear on leaderboards.
        </p>
      </div>
    );
  }

  if (step === 'show_code' || step === 'checking') {
    return (
      <div className="verification-panel">
        <div className="verification-header">
          <h3>Verify Your Identity</h3>
          <p>Prove you own @{verificationData?.inat_username} on iNaturalist</p>
        </div>

        <div className="verification-steps">
          <div className="verification-step">
            <span className="step-number">1</span>
            <div className="step-content">
              <p>Copy this code:</p>
              <div className="verification-code-box">
                <code className="verification-code">{verificationData?.verification_code}</code>
                <button
                  className="copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(verificationData?.verification_code || '');
                  }}
                  title="Copy to clipboard"
                >
                  📋
                </button>
              </div>
            </div>
          </div>

          <div className="verification-step">
            <span className="step-number">2</span>
            <div className="step-content">
              <p>Add it anywhere in your iNaturalist profile bio:</p>
              <a
                href={verificationData?.edit_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Edit Your iNat Profile →
              </a>
              <p className="step-hint">
                (Scroll down to "Bio" field, paste the code, and click "Save")
              </p>
            </div>
          </div>

          <div className="verification-step">
            <span className="step-number">3</span>
            <div className="step-content">
              <p>After saving, click below to verify:</p>
              <button
                className="btn btn-primary"
                onClick={handleCheckVerification}
                disabled={step === 'checking'}
              >
                {step === 'checking' ? 'Checking...' : 'Check Now'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="verification-error">
            <p>{error}</p>
            {checkAttempts >= 2 && (
              <p className="error-hint">
                Tip: Make sure you saved your profile changes on iNaturalist.
                The code should be visible on your{' '}
                <a
                  href={verificationData?.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  public profile
                </a>
                .
              </p>
            )}
          </div>
        )}

        <div className="verification-footer">
          <button className="btn-link" onClick={handleRegenerateCode} disabled={loading}>
            {loading ? 'Generating...' : 'Generate new code'}
          </button>
          <span className="separator">·</span>
          <button className="btn-link" onClick={handleStartOver}>
            Start over
          </button>
        </div>

        <p className="verification-expires">
          Code expires in {verificationData?.expires_in_minutes || 30} minutes
        </p>
      </div>
    );
  }

  // Default: enter_username step
  return (
    <div className="verification-panel">
      <div className="verification-header">
        <h3>Link Your iNaturalist Account</h3>
        <p>Verify your identity to participate in competitive gameplay</p>
      </div>

      <form onSubmit={handleUsernameSubmit} className="verification-form">
        <div className="input-group">
          <span className="input-prefix">@</span>
          <input
            type="text"
            placeholder="your_inat_username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            className="verification-input"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="btn btn-primary"
        >
          {loading ? 'Looking up...' : 'Continue'}
        </button>
      </form>

      {error && <p className="verification-error">{error}</p>}

      <p className="verification-note">
        We'll verify you own this account without needing any permissions.
        You'll add a temporary code to your iNat profile bio.
      </p>
    </div>
  );
}
