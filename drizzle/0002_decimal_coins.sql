-- Coins gain four decimals: every coin column now counts units of 1/10,000
-- coin, so each stored whole-coin value is multiplied by 10,000. The columns
-- stay INTEGER and no table is rebuilt. drizzle's migrator runs this file once
-- (it records it in __drizzle_migrations) and inside one transaction, so a
-- failure leaves every value as it was.
--
-- Guard first: a value past 900,719,925,474 coins would no longer fit a JS
-- number to the unit (and SQLite would turn the product into a REAL). The
-- CHECK fails the migration, which rolls back, instead of storing that.
CREATE TEMP TABLE `_decimal_coins_guard` (`v` INTEGER NOT NULL CHECK (`v` <= 900719925474));
--> statement-breakpoint
INSERT INTO `_decimal_coins_guard` (`v`)
SELECT coalesce(max(abs(`coins`)), 0) FROM `players`
UNION ALL SELECT coalesce(max(abs(`peak_coins`)), 0) FROM `players`
UNION ALL SELECT coalesce(max(abs(`amount`)), 0) FROM `coin_transactions`
UNION ALL SELECT coalesce(max(abs(`balance_after`)), 0) FROM `coin_transactions`
UNION ALL SELECT coalesce(max(abs(`coins`)), 0) FROM `gem_conversions`
UNION ALL SELECT coalesce(max(abs(`amount`)), 0) FROM `allowance_claims`
UNION ALL SELECT coalesce(max(abs(`stake`)), 0) FROM `game_rounds`
UNION ALL SELECT coalesce(max(abs(`payout`)), 0) FROM `game_rounds`
UNION ALL SELECT coalesce(max(abs(`amount`)), 0) FROM `table_wagers`;
--> statement-breakpoint
DROP TABLE `_decimal_coins_guard`;
--> statement-breakpoint
UPDATE `players` SET `coins` = `coins` * 10000, `peak_coins` = `peak_coins` * 10000;
--> statement-breakpoint
UPDATE `coin_transactions` SET `amount` = `amount` * 10000, `balance_after` = `balance_after` * 10000;
--> statement-breakpoint
UPDATE `gem_conversions` SET `coins` = `coins` * 10000;
--> statement-breakpoint
UPDATE `allowance_claims` SET `amount` = `amount` * 10000;
--> statement-breakpoint
UPDATE `game_rounds` SET `stake` = `stake` * 10000, `payout` = `payout` * 10000;
--> statement-breakpoint
UPDATE `table_wagers` SET `amount` = `amount` * 10000;
