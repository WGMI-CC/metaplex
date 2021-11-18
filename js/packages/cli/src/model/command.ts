type CommandAction = (...args: any[]) => void | Promise<void>;
type ArgumentParser = (value: string, previous: string[]) => string[];
type OptionDefaultValue = string | ((value: string) => void);

interface CommandSpec {
  name: string;
  action: CommandAction;
  arguments?: CommandArgument[];
  options?: CommandOption[];
}

class CommandArgument {
  public readonly flags: string;
  public readonly description: string;
  public readonly parser?: ArgumentParser;

  private constructor(
    flags: string,
    description: string,
    parser?: ArgumentParser,
  ) {
    this.flags = flags;
    this.description = description;
    this.parser = parser;
  }

  public static of(
    flags: string,
    description: string,
    parser?: ArgumentParser,
  ): CommandArgument {
    return new CommandArgument(flags, description, parser);
  }
}

class CommandOption {
  public readonly flags: string;
  public readonly description: string;
  public readonly defaultValue?: string | ((value: string) => void);

  private constructor(
    flags: string,
    description: string,
    defaultValue?: OptionDefaultValue,
  ) {
    this.flags = flags;
    this.description = description;
    this.defaultValue = defaultValue;
  }

  public static of(
    flags: string,
    description: string,
    defaultValue?: OptionDefaultValue,
  ): CommandOption {
    return new CommandOption(flags, description, defaultValue);
  }
}

export {
  CommandSpec,
  CommandArgument,
  CommandOption,
  CommandAction,
  ArgumentParser,
  OptionDefaultValue,
};
