package db_sampler

import "regexp"

// DefaultProcessor returns a Chain pre-loaded with general PII rules:
// structural columns (email/ip/name/user_agent variants), text regexes (emails,
// URL-encoded emails, IPv4/IPv6, IBAN, generic phone numbers), and a
// Shannon-entropy redactor (threshold 4.8, min token length 12).
//
// Project-specific patterns (internal FQDNs, regional ID formats, etc.) belong
// in the calling CLI — compose them with Chain to extend.
func DefaultProcessor() Processor {
	return Chain(
		StructuralColumns(map[string]ColumnRule{
			"email":              Action(ScrambleEmail),
			"user_email":         Action(ScrambleEmail),
			"email_address":      Action(ScrambleEmail),
			"ip":                 Action(ScrambleIPAction),
			"ip_address":         Action(ScrambleIPAction),
			"remote_addr":        Action(ScrambleIPAction),
			"remote_ip":          Action(ScrambleIPAction),
			"client_ip":          Action(ScrambleIPAction),
			"request__remote_ip": Action(ScrambleIPAction),
			"request__client_ip": Action(ScrambleIPAction),
			"x_forwarded_for":    Action(ScrambleIPAction),
			"user_agent":         ReplaceWith("REDACTED"),
			"username":           Action(ScrambleName),
			"user_name":          Action(ScrambleName),
			"full_name":          Action(ScrambleName),
			"first_name":         Action(ScrambleName),
			"last_name":          Action(ScrambleName),
		}),
		TextRegex(regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`), "<EMAIL>"),
		TextRegex(regexp.MustCompile(`[a-zA-Z0-9._+\-]+%40[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`), "<EMAIL>"),
		TextRegex(regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`), "<IP>"),
		TextRegex(regexp.MustCompile(`\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b`), "<IP6>"),
		TextRegex(regexp.MustCompile(`\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,}\b`), "<IBAN>"),
		RedactHighEntropyTokens(4.8, 12),
	)
}
