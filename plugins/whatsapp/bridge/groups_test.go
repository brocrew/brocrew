package main

import (
	"context"
	"testing"
	"time"
)

func TestGroupRefreshBypassesCache(t *testing.T) {
	s := &session{groups: []groupView{{JID: "120363000000000001@g.us", Name: "ATLAS Team"}}, groupAt: time.Now()}
	cached, err := s.groupsFor(context.Background(), false)
	if err != nil || len(cached) != 1 || cached[0].Name != "ATLAS Team" {
		t.Fatalf("fresh cached groups: %v, %v", cached, err)
	}
	// With no linked client, a forced read must fail rather than return the cache.
	if _, err := s.groupsFor(context.Background(), true); err == nil {
		t.Fatal("refresh returned cached groups")
	}
}
