package com.courtside.ai.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

public record SchedulePromptRequest(
    @NotBlank @Size(max = 1000) String prompt,
    ScheduleConfig currentConfig,
    List<String> currentPlayerNames
) {
}
