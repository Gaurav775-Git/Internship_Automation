import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';

export async function showBanner() {
  return new Promise((resolve) => {
    figlet.text('AutoIntern', { font: 'ANSI Shadow' }, (err, data) => {
      if (err) {
        console.log('AutoIntern - Internship Automation');
        return resolve();
      }
      const gradientText = gradient.pastel.multiline(data);
      console.log(boxen(gradientText, {
        padding: 1,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'cyan',
        title: '🤖 v2.0',
        titleAlignment: 'center'
      }));
      console.log(gradient.rainbow('    Automate Your Internship Journey\n'));
      console.log('    ' + '─'.repeat(50));
      console.log('    📧 Auto-Apply | 🤖 AI-Powered | 📊 Smart Tracking');
      console.log('    ' + '─'.repeat(50) + '\n');
      resolve();
    });
  });
}
