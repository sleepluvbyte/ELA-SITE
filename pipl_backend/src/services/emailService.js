import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendVerificationCode(email, code) {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '🔐 Код подтверждения - Coffee Shop',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #7FB5A8 0%, #A8D5C9 100%); padding: 40px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 32px;">☕ Coffee Shop</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #3D7A6D; margin-top: 0;">Код подтверждения</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Здравствуйте! Вы запросили код подтверждения для входа в систему Coffee Shop.
          </p>
          <div style="background: #EEF7F5; padding: 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
            <div style="font-size: 36px; font-weight: bold; color: #3D7A6D; letter-spacing: 8px;">
              ${code}
            </div>
          </div>
          <p style="color: #999; font-size: 14px;">
            Код действителен в течение 10 минут. Если вы не запрашивали этот код, проигнорируйте это письмо.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            © 2026 Coffee Shop. Все права защищены.
          </p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Email error:', error);
    return false;
  }
}

export async function sendWelcomeEmail(email, name) {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '🎉 Добро пожаловать в Coffee Shop!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #7FB5A8 0%, #A8D5C9 100%); padding: 40px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0;">Добро пожаловать!</h1>
        </div>
        <div style="background: white; padding: 40px; border-radius: 0 0 12px 12px;">
          <h2 style="color: #3D7A6D;">Привет, ${name}! 👋</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Спасибо, что присоединились к Coffee Shop! Теперь вы можете собирать кофейные зёрна и получать бесплатные напитки.
          </p>
          <div style="background: #EEF7F5; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <h3 style="color: #3D7A6D; margin-top: 0;">Как это работает?</h3>
            <ul style="color: #666; line-height: 1.8;">
              <li>☕ Покупайте напитки и получайте зёрна</li>
              <li>🌱 1 покупка = 1 зерно</li>
              <li>🎁 Соберите 7 зёрен = бесплатный напиток</li>
            </ul>
          </div>
          <p style="color: #999; font-size: 14px;">
            Покажите ваш QR-код бариста при следующей покупке!
          </p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}