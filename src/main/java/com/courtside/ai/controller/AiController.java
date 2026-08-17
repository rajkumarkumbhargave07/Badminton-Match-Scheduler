package com.courtside.ai.controller;

import com.courtside.ai.dto.AiInsightRequest;
import com.courtside.ai.dto.AiInsightResponse;
import com.courtside.ai.dto.SchedulePromptRequest;
import com.courtside.ai.dto.SchedulePromptResponse;
import com.courtside.ai.service.AiInsightService;
import com.courtside.ai.service.SchedulePromptService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class AiController {

  private final AiInsightService insightService;
  private final SchedulePromptService schedulePromptService;

  public AiController(AiInsightService insightService, SchedulePromptService schedulePromptService) {
    this.insightService = insightService;
    this.schedulePromptService = schedulePromptService;
  }

  @PostMapping("/insights")
  public AiInsightResponse insights(@Valid @RequestBody AiInsightRequest request) {
    return new AiInsightResponse(insightService.generateInsight(request));
  }

  @PostMapping("/schedule-config")
  public SchedulePromptResponse scheduleConfig(@Valid @RequestBody SchedulePromptRequest request) {
    return schedulePromptService.extractSchedule(request);
  }
}
