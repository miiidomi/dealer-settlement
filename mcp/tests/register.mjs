import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(specifier,context,next){
  if (specifier.startsWith('.') && context.parentURL) {
    const candidate=new URL(specifier+'.ts',context.parentURL);
    if (!/\.[a-z]+$/i.test(specifier) && existsSync(fileURLToPath(candidate))) return next(candidate.href,context);
  }
  return next(specifier,context);
}});
