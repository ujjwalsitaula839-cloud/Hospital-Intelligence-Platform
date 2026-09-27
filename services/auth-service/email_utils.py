import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging
import smtplib
from typing import Optional

from core.config import settings

logger = logging.getLogger("hip.email")


def build_reset_email_html(reset_url: str, recipient_email: str) -> str:
    """Generate responsive clinical HTML email for password reset."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HIP Password Reset</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #09090b;
      color: #f4f4f5;
      margin: 0;
      padding: 30px 15px;
    }}
    .container {{
      max-width: 580px;
      margin: 0 auto;
      background-color: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }}
    .header {{
      border-bottom: 1px solid #27272a;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      padding: 4px 8px;
      border-radius: 4px;
      margin-bottom: 12px;
    }}
    h1 {{
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
    }}
    p {{
      font-size: 14px;
      line-height: 1.6;
      color: #d4d4d8;
      margin: 14px 0;
    }}
    .btn-container {{
      margin: 28px 0;
      text-align: center;
    }}
    .btn {{
      display: inline-block;
      background-color: #ffffff;
      color: #09090b !important;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 6px;
      letter-spacing: 0.02em;
    }}
    .btn:hover {{
      background-color: #e4e4e7;
    }}
    .link-fallback {{
      background-color: #09090b;
      border: 1px solid #27272a;
      border-radius: 4px;
      padding: 12px;
      font-size: 12px;
      font-family: monospace;
      color: #38bdf8;
      word-break: break-all;
      margin: 16px 0;
    }}
    .footer {{
      border-top: 1px solid #27272a;
      padding-top: 20px;
      margin-top: 28px;
      font-size: 12px;
      color: #71717a;
      line-height: 1.5;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Hospital Intelligence Platform (HIP)</div>
      <h1>Password Reset Request</h1>
    </div>
    <p>Hello,</p>
    <p>A password reset was requested for your account (<strong>{recipient_email}</strong>). Click the button below to choose a new password:</p>
    
    <div class="btn-container">
      <a href="{reset_url}" class="btn" target="_blank" rel="noopener noreferrer">Reset Password</a>
    </div>

    <p>If the button doesn't work, copy and paste this link into your browser:</p>
    <div class="link-fallback">{reset_url}</div>

    <p style="color: #f87171; font-size: 13px;">
      ⚠️ <strong>Notice:</strong> This link expires in 15 minutes and can only be used once.
    </p>

    <div class="footer">
      <p>If you did not request this password reset, you can safely ignore this email. Your existing credentials remain secure.</p>
      <p>HIP Security Infrastructure • 21 CFR Part 11 &amp; HIPAA Compliant System</p>
    </div>
  </div>
</body>
</html>"""


def _send_smtp_sync(msg: MIMEMultipart, recipient: str) -> None:
    """Synchronous fallback sender using standard library smtplib."""
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0) as server:
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(msg)


async def send_password_reset_email(to_email: str, raw_token: str) -> None:
    """
    Dispatch a password reset email asynchronously to Mailpit / configured SMTP.
    Uses aiosmtplib if available, otherwise runs smtplib in a background thread.
    Never logs raw reset tokens to console or stdout.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Password Reset - Hospital Intelligence Platform"
    msg["From"] = settings.EMAILS_FROM_EMAIL
    msg["To"] = to_email

    text_content = (
        f"Password Reset Request\n\n"
        f"A password reset was requested for your account ({to_email}).\n"
        f"To reset your password, visit the following link:\n{reset_url}\n\n"
        f"This link expires in 15 minutes and can only be used once.\n"
        f"If you did not request this, ignore this email."
    )
    html_content = build_reset_email_html(reset_url, to_email)

    msg.attach(MIMEText(text_content, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        try:
            import aiosmtplib  # type: ignore

            kwargs = {
                "hostname": settings.SMTP_HOST,
                "port": settings.SMTP_PORT,
                "timeout": 10.0,
            }
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                kwargs["username"] = settings.SMTP_USER
                kwargs["password"] = settings.SMTP_PASSWORD

            await aiosmtplib.send(msg, **kwargs)
            logger.info("Password reset email sent via aiosmtplib to %s", to_email)
        except (ImportError, Exception) as async_err:
            logger.debug("aiosmtplib failed or not available (%s), using smtplib fallback", async_err)
            await asyncio.to_thread(_send_smtp_sync, msg, to_email)
            logger.info("Password reset email sent via standard smtplib to %s", to_email)
    except Exception as e:
        logger.error("Failed to send password reset email to %s: %s", to_email, e)
