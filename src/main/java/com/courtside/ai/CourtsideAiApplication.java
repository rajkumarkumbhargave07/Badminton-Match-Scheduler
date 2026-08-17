package com.courtside.ai;

import com.courtside.ai.config.AppCorsProperties;
import com.courtside.ai.config.LlmProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties({LlmProperties.class, AppCorsProperties.class})
public class CourtsideAiApplication {

  public static void main(String[] args) {
    SpringApplication.run(CourtsideAiApplication.class, args);
  }
}
