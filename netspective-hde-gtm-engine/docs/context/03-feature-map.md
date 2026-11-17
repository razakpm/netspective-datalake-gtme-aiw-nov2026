# Feature map (Spec Kit feature numbers)

| # | Branch | Depends on | MVP |
|---|---|---|---|
| 001 | 001-project-foundation | — | yes |
| 002 | 002-accounts-contacts-icp | 001 | yes |
| 003 | 003-signals-evidence | 002 | yes |
| 004 | 004-account-research-hypotheses | 003 | yes |
| 005 | 005-capabilities-offers-claims | 001 | yes |
| 006 | 006-offer-routing-lead-magnet | 002, 004, 005 | yes |
| 007 | 007-workshop-operations | 006 | yes |
| 008 | 008-qualification-paid-scope | 007 | yes |
| 009 | 009-content-communication | 005, 006 | yes (one email adapter) |
| 010 | 010-engagement-reply-intelligence | 009 | yes (human-approved replies) |
| 011 | 011-intent-next-best-action | 004, 008, 010 | yes |
| 012 | 012-pipeline-experiments-analytics | 008, 010 | yes |
| 013 | 013-operator-dashboard | all above (UI shells built incrementally from 002) | yes |

Each feature ships its own minimal operator UI screens; 013 unifies navigation, dashboards and reporting.