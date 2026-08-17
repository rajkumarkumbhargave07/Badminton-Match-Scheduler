package com.courtside.ai.dto;

import java.util.List;

public record SchedulePromptResponse(
    Integer numPlayers,
    Integer durationValue,
    String durationUnit,
    Integer gamePoint,
    Integer matchCount,
    List<String> playerNames,
    String note
) {
}
