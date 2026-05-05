export enum LogLevel {
	Debug = "debug",
	Info = "info",
	Warn = "warn",
	Error = "error",
}

export interface LogContext {
	readonly [key: string]: unknown;
}

interface LogRecord {
	readonly level: LogLevel;
	readonly time: string;
	readonly message: string;
	readonly context?: LogContext;
}

const writers: Record<LogLevel, (line: string) => void> = {
	[LogLevel.Debug]: (line) => console.debug(line),
	[LogLevel.Info]: (line) => console.info(line),
	[LogLevel.Warn]: (line) => console.warn(line),
	[LogLevel.Error]: (line) => console.error(line),
};

const write = (level: LogLevel, message: string, context?: LogContext): void => {
	const record: LogRecord = {
		level,
		time: new Date().toISOString(),
		message,
		...(context ? { context } : {}),
	};
	writers[level](JSON.stringify(record));
};

export const logger = {
	debug: (message: string, context?: LogContext) => write(LogLevel.Debug, message, context),
	info: (message: string, context?: LogContext) => write(LogLevel.Info, message, context),
	warn: (message: string, context?: LogContext) => write(LogLevel.Warn, message, context),
	error: (message: string, context?: LogContext) => write(LogLevel.Error, message, context),
};
