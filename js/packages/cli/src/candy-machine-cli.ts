import { Command, program } from 'commander';
import log from 'loglevel';
import { COMMAND_SPEC as UPLOAD_SPEC } from './commands/upload';
import { COMMAND_SPEC as CREATE_CANDY_MACHINE_SPEC } from './commands/createCandyMachine';
import { COMMAND_SPEC as UPDATE_CANDY_MACHINE_SPEC } from './commands/updateCandyMachine';
import { COMMAND_SPEC as MINT_ONE_TOKEN_SPEC } from './commands/mintOneToken';
import { COMMAND_SPEC as VERIFY_CANDY_MACHINE_SPEC } from './commands/verify';
import { CommandOption, CommandSpec } from './model/command';

const GLOBAL_OPTIONS: CommandOption[] = [
  CommandOption.of('-e, --env <string>', 'Solana cluster env name', 'devnet'),
  CommandOption.of(
    '-k, --keypair <path>',
    'Solana wallet location',
    '--keypair not provided',
  ),
  CommandOption.of('-l, --log-level <string>', 'log level', setLogLevel),
  CommandOption.of('-c, --cache-name <string>', 'Cache file name', 'temp'),
];

function makeCommand(spec: CommandSpec): Command {
  const command: Command = program.command(spec.name);
  if (spec.arguments) {
    for (const argument of spec.arguments) {
      command.argument(argument.flags, argument.description, argument.parser);
    }
  }
  for (const option of GLOBAL_OPTIONS) {
    applyOptionToCommand(command, option);
  }
  if (spec.options) {
    for (const option of spec.options) {
      applyOptionToCommand(command, option);
    }
  }
  return command.action(spec.action);
}

function applyOptionToCommand(command: Command, option: CommandOption): void {
  if (option.defaultValue instanceof String) {
    command.option(
      option.flags,
      option.description,
      option.defaultValue as string,
    );
  } else {
    command.option(
      option.flags,
      option.description,
      option.defaultValue as (value: string) => void,
    );
  }
}

function setLogLevel(value: string): void {
  if (value === undefined || value === null) return;
  log.info('setting the log value to: ' + value);
  log.setLevel(value as log.LogLevelDesc);
}

makeCommand(UPLOAD_SPEC);
makeCommand(CREATE_CANDY_MACHINE_SPEC);
makeCommand(VERIFY_CANDY_MACHINE_SPEC);
makeCommand(UPDATE_CANDY_MACHINE_SPEC);
makeCommand(MINT_ONE_TOKEN_SPEC);
program.parse(process.argv);
