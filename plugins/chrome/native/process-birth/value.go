package main

import (
	"fmt"
	"strconv"
)

const (
	filetimeEpochTicks uint64 = 504911232000000000
	maxFiletime        uint64 = 2650467743999999999
)

func ticksFromFiletime(high, low uint32) (uint64, error) {
	filetime := uint64(high)<<32 | uint64(low)
	if filetime > maxFiletime {
		return 0, fmt.Errorf("FILETIME %d exceeds .NET DateTime range", filetime)
	}
	return filetime + filetimeEpochTicks, nil
}

func parsePID(value string) (uint32, error) {
	if value == "" {
		return 0, fmt.Errorf("PID must be a positive uint32 in decimal")
	}
	for _, c := range value {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("PID %q must contain only decimal digits", value)
		}
	}
	pid, err := strconv.ParseUint(value, 10, 32)
	if err != nil || pid == 0 {
		return 0, fmt.Errorf("PID %q must be between 1 and 4294967295", value)
	}
	return uint32(pid), nil
}
