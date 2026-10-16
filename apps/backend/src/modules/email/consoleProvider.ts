import { EmailProvider, OutgoingEmail } from './provider';

/** Development provider: logs the recipient, subject and the TEXT part only (never the HTML). Default when NODE_ENV !== 'production'. */
export class ConsoleProvider implements EmailProvider {
  readonly name = 'console';
  private seq = 0;

  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  async send(email: OutgoingEmail) {
    const id = `console-${Date.now()}-${++this.seq}`;
    this.log(`[email:console] ${id}\nto: ${email.to}\nsubject: ${email.subject}\n\n${email.text}`);
    return { providerMessageId: id };
  }
}
