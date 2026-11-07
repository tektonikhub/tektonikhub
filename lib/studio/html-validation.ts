import { Script } from 'node:vm';
import { validateHTMLApplication, type HTMLApplication } from './html-generation';

/** Compile only: generated code is never evaluated in the server process. */
export function validateGeneratedHTML(input: unknown): HTMLApplication {
  const application = validateHTMLApplication(input);
  for (const script of application.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\btype\s*=\s*["']application\/json["']/i.test(script[1])) continue;
    try { new Script(script[2], { filename: 'generated-application.js' }); }
    catch (error) { throw new Error(`Inline JavaScript syntax is invalid: ${error instanceof Error ? error.message.slice(0, 300) : 'syntax error'}`); }
  }
  return application;
}
