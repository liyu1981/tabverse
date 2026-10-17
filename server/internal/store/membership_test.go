package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

const testPeriodMS = int64(30 * 24 * time.Hour / time.Millisecond)

func TestGrantTrialIsOnceAndOpensTheFirstPeriod(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "trial")
	before := time.Now().UnixMilli()

	m, err := st.GrantTrial(ctx, userID, 30, 30, testPeriodMS)
	if err != nil {
		t.Fatalf("grant trial: %v", err)
	}
	if m.TrialGrantedAt == 0 {
		t.Fatal("the trial should stamp trial_granted_at")
	}
	// 30 credited, 30 spent on the first period: the trial *is* the period.
	if m.Credits != 0 {
		t.Fatalf("credits = %d, want 0 (the trial paid for the period)", m.Credits)
	}
	if m.ExpiresAt < before+testPeriodMS {
		t.Fatalf("expires_at = %d, want about now+period", m.ExpiresAt)
	}

	// A second grant is a no-op, whatever it is asked for.
	again, err := st.GrantTrial(ctx, userID, 999, 30, testPeriodMS)
	if err != nil {
		t.Fatalf("second grant: %v", err)
	}
	if again.Credits != 0 || again.ExpiresAt != m.ExpiresAt {
		t.Fatalf("a second trial changed the membership: %+v vs %+v", again, m)
	}
}

func TestGrantCreditsRefusesABalanceBelowZero(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "credits")

	if _, err := st.GrantCredits(ctx, userID, 30, ReasonGrant, "", "seed"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if _, err := st.GrantCredits(ctx, userID, -40, ReasonAdjustment, "", "too much"); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("debit below zero: err = %v, want ErrInsufficientCredits", err)
	}
	m, err := st.Membership(ctx, userID)
	if err != nil {
		t.Fatalf("membership: %v", err)
	}
	if m.Credits != 30 {
		t.Fatalf("a refused debit changed the balance: %d", m.Credits)
	}

	ledger, err := st.Ledger(ctx, userID, 10)
	if err != nil {
		t.Fatalf("ledger: %v", err)
	}
	// Only the successful grant is recorded; the refused debit left nothing.
	if len(ledger) != 1 || ledger[0].Delta != 30 || ledger[0].Balance != 30 {
		t.Fatalf("ledger = %+v", ledger)
	}
}

func TestRenewIfFunded(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "renew")

	// Seed two periods' worth, spend one.
	if _, err := st.GrantCredits(ctx, userID, 60, ReasonGrant, "", ""); err != nil {
		t.Fatalf("grant: %v", err)
	}
	m, err := st.OpenPeriod(ctx, userID, 30, testPeriodMS, "", "")
	if err != nil {
		t.Fatalf("open period: %v", err)
	}
	if m.Credits != 30 {
		t.Fatalf("credits after one period = %d, want 30", m.Credits)
	}
	first := m.ExpiresAt

	renewed, err := st.RenewIfFunded(ctx, userID, 30, testPeriodMS)
	if err != nil {
		t.Fatalf("renew: %v", err)
	}
	if !renewed {
		t.Fatal("a funded account should renew")
	}
	m, _ = st.Membership(ctx, userID)
	if m.Credits != 0 {
		t.Fatalf("credits after renew = %d, want 0", m.Credits)
	}
	if m.ExpiresAt != first+testPeriodMS {
		t.Fatalf("expires_at = %d, want %d (extended by one period)", m.ExpiresAt, first+testPeriodMS)
	}

	renewed, err = st.RenewIfFunded(ctx, userID, 30, testPeriodMS)
	if err != nil {
		t.Fatalf("renew unfunded: %v", err)
	}
	if renewed {
		t.Fatal("an unfunded account must not renew")
	}
}

func TestDueScansAndMarkExpired(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "due")
	now := time.Now()
	retention := int64(90 * 24 * time.Hour / time.Millisecond)

	// Lapsed an hour ago, and closeable after the retention window.
	if _, err := st.SetMembership(ctx, userID, now.Add(-time.Hour).UnixMilli(), false, "", "test"); err != nil {
		t.Fatalf("set membership: %v", err)
	}

	expired, err := st.DueForExpiry(ctx, now.UnixMilli())
	if err != nil {
		t.Fatalf("due for expiry: %v", err)
	}
	if len(expired) != 1 || expired[0].UserID != userID {
		t.Fatalf("DueForExpiry = %+v", expired)
	}
	if err := st.MarkExpired(ctx, userID); err != nil {
		t.Fatalf("mark expired: %v", err)
	}
	expired, _ = st.DueForExpiry(ctx, now.UnixMilli())
	if len(expired) != 0 {
		t.Fatal("a stamped account must not be reported expired twice")
	}

	closable, err := st.DueForPurge(ctx, now.UnixMilli(), retention)
	if err != nil {
		t.Fatalf("due for purge: %v", err)
	}
	if len(closable) != 0 {
		t.Fatal("an account inside the retention window must not be closable")
	}
	closable, _ = st.DueForPurge(ctx, now.Add(91*24*time.Hour).UnixMilli(), retention)
	if len(closable) != 1 {
		t.Fatalf("past the retention window the account should be closable, got %+v", closable)
	}
}

func TestExportRecordsStreamsLiveRecordsOut(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	userID := mustCreateUser(t, st, "export")
	now := time.Now().UnixMilli()
	if _, _, err := st.ApplyRecords(ctx, userID, "dev_1", []RecordInput{
		{Entity: "note", ID: "n1", UpdatedAt: now, Payload: `{"text":"keep"}`},
		{Entity: "todo", ID: "t1", UpdatedAt: now, Deleted: true},
	}, 1<<20); err != nil {
		t.Fatalf("apply: %v", err)
	}
	var got []string
	if err := st.ExportRecords(ctx, userID, func(r Record) error {
		got = append(got, r.Entity+"/"+r.ID)
		return nil
	}); err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(got) != 1 || got[0] != "note/n1" {
		t.Fatalf("export = %v, want only the live note", got)
	}
}

func TestSettingRoundTrip(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()
	if _, ok, err := st.SettingBool(ctx, "missing"); err != nil || ok {
		t.Fatalf("missing setting: ok=%v err=%v", ok, err)
	}
	if err := st.PutSetting(ctx, "membership_enabled", "true", ""); err != nil {
		t.Fatalf("put: %v", err)
	}
	v, ok, err := st.SettingBool(ctx, "membership_enabled")
	if err != nil || !ok || !v {
		t.Fatalf("read back: v=%v ok=%v err=%v", v, ok, err)
	}
}
